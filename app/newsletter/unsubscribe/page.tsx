import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { Check, AlertTriangle } from "../../icons";

export const metadata: Metadata = { title: "Unsubscribed", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Leaving, in one click and with no questions.
//
// No sign in, no confirmation step, no "are you sure". Making somebody work to leave a
// list is what turns an unsubscribe into a spam complaint, and a complaint costs the
// sending reputation that every transactional email in this product depends on.
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const token = ((await searchParams).token ?? "").trim();
  let ok = false;

  if (token.length >= 16) {
    const { error } = await createAdminClient()
      .from("newsletter_subscribers")
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq("token", token);
    ok = !error;
  }

  return (
    <div className="susp">
      <div className="card mfacard">
        {ok ? (
          <>
            <h2><Check size={18} /> Done, you are off the list</h2>
            <p className="muted">
              No more newsletters. Anything about your own account, like a receipt or a
              security code, still reaches you, because that is not marketing.
            </p>
          </>
        ) : (
          <>
            <h2><AlertTriangle size={18} /> We could not find that link</h2>
            <p className="muted">
              You may already be unsubscribed. If you keep receiving newsletters, email
              info@fresh-leads.io and we will remove you by hand.
            </p>
          </>
        )}
        <Link className="go accent" href="/">Back to Fresh Leads</Link>
      </div>
    </div>
  );
}
