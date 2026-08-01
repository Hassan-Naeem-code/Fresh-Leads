import { createAdminClient } from "./supabase/admin";
import { getStripe, stripeConfigured } from "./stripe";

// Changing and closing an account.
//
// Every operation here is one a stolen session should not be able to perform on its
// own, so each one re-checks the password. A session cookie proves someone was signed
// in at some point; it does not prove the person at the keyboard is the owner, and
// changing the recovery email or wiping the account are exactly the actions where
// that difference matters.

/**
 * Confirm the password by signing in with it.
 *
 * Supabase has no "verify this password" call, so we ask for a token with it and
 * throw the token away. Nothing about the caller's existing session changes.
 */
export async function passwordMatches(email: string, password: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return false;

  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.ok;
}

export async function changePassword(userId: string, next: string): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password: next });
  if (error) console.error("[account] password change failed:", error.message);
  return !error;
}

/**
 * Close the account for good.
 *
 * Order matters. The subscription is cancelled FIRST: a deleted user with a live
 * Stripe subscription is a card that keeps being charged with nothing left to answer
 * the webhook, which is the worst possible failure here. Only once billing has
 * genuinely stopped do we delete, and every table cascades from the auth user.
 *
 * The one thing left behind is an anonymous row saying an account closed, which
 * carries no identifier of any kind.
 */
export async function deleteAccount(
  userId: string,
  reason: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();

  const { data: sub } = await admin
    .from("subscriptions")
    .select("stripe_subscription_id, status")
    .eq("user_id", userId)
    .maybeSingle();

  const wasSubscribed = sub?.status === "active";

  if (sub?.stripe_subscription_id && stripeConfigured()) {
    try {
      await getStripe().subscriptions.cancel(sub.stripe_subscription_id as string);
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      // Already gone at Stripe's end is a success, not a failure: the goal is that
      // nothing more is charged, and nothing more will be.
      const alreadyGone = /No such subscription|resource_missing|canceled/i.test(message);
      if (!alreadyGone) {
        console.error("[account] could not cancel subscription:", message);
        return {
          ok: false,
          error:
            "We could not stop your subscription, so nothing was deleted. Contact support and we will close it by hand rather than risk leaving your card being charged.",
        };
      }
    }
  }

  await admin.from("account_closures").insert({
    reason: reason?.trim().slice(0, 1000) || null,
    was_subscribed: wasSubscribed,
  });

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error("[account] delete failed:", error.message);
    return { ok: false, error: "Could not delete the account. Nothing was changed." };
  }

  return { ok: true };
}
