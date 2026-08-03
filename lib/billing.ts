import type { NextRequest } from "next/server";
import { createAdminClient } from "./supabase/admin";
import { getStripe } from "./stripe";
import { siteUrl } from "./site-url";

// Shared plumbing for the two things we sell: the yearly subscription and credit
// top-ups.

/**
 * The Stripe customer for this user, created once and remembered on their profile,
 * so a returning buyer keeps one customer record and one saved card.
 */
export async function getOrCreateCustomer(userId: string, email: string | null): Promise<string> {
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_customer_id, email, full_name")
    .eq("id", userId)
    .maybeSingle();

  if (profile?.stripe_customer_id) return profile.stripe_customer_id as string;

  const customer = await getStripe().customers.create({
    email: profile?.email ?? email ?? undefined,
    name: profile?.full_name ?? undefined,
    metadata: { user_id: userId },
  });
  await admin.from("profiles").update({ stripe_customer_id: customer.id }).eq("id", userId);
  return customer.id;
}

/** Hosts we will redirect back to after Stripe. */
function allowedOrigin(req: NextRequest): string {
  const configured = siteUrl();
  const origin = req.headers.get("origin");

  // The Origin header decides which host we return to, so the session cookie is
  // present after the redirect (apex vs www matters). But it is client-supplied, so
  // it is only honoured when it matches the configured site or is localhost during
  // development, never as a free-form redirect target.
  if (origin) {
    if (configured && sameHost(origin, configured)) return origin;
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return origin;
    if (configured && isSiblingHost(origin, configured)) return origin;
  }
  // NEVER the request host. A checkout that starts on a preview or deployment URL
  // would send the customer back there after paying, and that URL 404s the moment the
  // deployment is superseded. That is exactly the "DEPLOYMENT_NOT_FOUND" a customer
  // saw after handing over their card.
  return configured;
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

/** Treat fresh-leads.io and www.fresh-leads.io as the same site. */
function isSiblingHost(a: string, b: string): boolean {
  try {
    const strip = (h: string) => h.replace(/^www\./, "");
    return strip(new URL(a).host) === strip(new URL(b).host);
  } catch {
    return false;
  }
}

export function checkoutUrls(req: NextRequest, successPath: string) {
  const base = allowedOrigin(req);
  const joiner = successPath.includes("?") ? "&" : "?";
  return {
    success: `${base}${successPath}${joiner}session_id={CHECKOUT_SESSION_ID}`,
    cancel: `${base}/dashboard?checkout=cancelled`,
  };
}
