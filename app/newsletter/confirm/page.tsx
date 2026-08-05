import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { Check, AlertTriangle } from "../../icons";

export const metadata: Metadata = { title: "Confirm your email", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// The click that puts somebody on the list.
//
// Nothing is ever sent to an address that has not been through here, which is what
// stops a public form being used to sign strangers up and generate spam complaints
// against the domain that also sends every two factor code in the product.
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const token = ((await searchParams).token ?? "").trim();
  let ok = false;

  if (token.length >= 16) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("newsletter_subscribers")
      .select("id")
      .eq("token", token)
      .maybeSingle();
    if (data) {
      await admin
        .from("newsletter_subscribers")
        .update({ confirmed_at: new Date().toISOString(), unsubscribed_at: null })
        .eq("id", data.id);
      ok = true;
    }
  }

  return (
    <div className="susp">
      <div className="card mfacard">
        {ok ? (
          <>
            <h2><Check size={18} /> You are on the list</h2>
            <p className="muted">
              Occasional notes about what we find in local business data, and what changes in
              the product. No more than monthly, and every one has an unsubscribe link.
            </p>
          </>
        ) : (
          <>
            <h2><AlertTriangle size={18} /> That link did not work</h2>
            <p className="muted">
              It may have already been used, or it may be incomplete. Enter your address again
              and we will send a fresh one.
            </p>
          </>
        )}
        <Link className="go accent" href="/">Back to Fresh Leads</Link>
      </div>
    </div>
  );
}
