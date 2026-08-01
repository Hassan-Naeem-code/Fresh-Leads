import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccess } from "@/lib/access";
import { Shield } from "../../icons";
import { AccountPanel } from "./AccountPanel";

export const metadata: Metadata = {
  title: "Account and security",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

// Never gated. Whatever else is locked, a person can always change their password and
// close their account: locking someone out of leaving is not a business model.
export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/account");

  const access = await getAccess(user.id);

  return (
    <div className="wrap">
      <div className="app-head">
        <span className="app-eyebrow">
          <Shield size={13} /> Account and security
        </span>
        <h1>Your sign in details.</h1>
        <p>
          Changing your password, your email address, or closing the account for good. Each one
          asks for your current password, because a session on its own is not proof of who is
          at the keyboard.
        </p>
      </div>

      <AccountPanel
        email={user.email ?? ""}
        createdAt={user.created_at}
        lastSignInAt={user.last_sign_in_at ?? null}
        subscribed={access.subscribed}
        credits={access.credits}
        renewsAt={access.subscription?.currentPeriodEnd ?? null}
      />
    </div>
  );
}
