import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { unsubscribeToken, tokenMatches } from "@/lib/email/compose";
import { suppress } from "@/lib/email/suppression";
import { getSiteSettings } from "@/lib/site-settings.server";
import { BrandMark, BrandName } from "../brand";
import { Check, AlertTriangle } from "../icons";

export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

// Opting out has to work without an account, without JavaScript, and on the first
// click. It is the one page in the product that a stranger uses, usually while
// annoyed, so it does the work on load rather than asking them to confirm.
//
// A wrong or missing token still shows a calm page rather than an error: someone who
// clicked unsubscribe should never be left wondering whether it worked.
export default async function Unsubscribe({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; t?: string }>;
}) {
  const [{ e: enrollmentId, t: token }, settings] = await Promise.all([
    searchParams,
    getSiteSettings(),
  ]);

  let state: "done" | "bad" = "bad";
  let address = "";

  if (enrollmentId && token) {
    const secret =
      process.env.EMAIL_TOKEN_SECRET ||
      process.env.ADMIN_SESSION_SECRET ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      "";
    const expected = unsubscribeToken(enrollmentId, secret);

    if (secret && tokenMatches(expected, token)) {
      const admin = createAdminClient();
      const { data: enr } = await admin
        .from("email_enrollments")
        .select("id, user_id, to_email")
        .eq("id", enrollmentId)
        .maybeSingle();

      if (enr) {
        address = enr.to_email as string;
        // Suppress first. If stopping the enrollment failed afterwards, the address is
        // still on the list, and the list is what the send loop checks.
        await suppress(enr.user_id as string, address, "unsubscribed");
        await admin
          .from("email_enrollments")
          .update({ status: "unsubscribed", next_run_at: null, updated_at: new Date().toISOString() })
          .eq("id", enrollmentId);
        state = "done";
      }
    }
  }

  return (
    <div className="unsub">
      <div className="unsubcard">
        <span className="unsubbrand">
          <BrandMark settings={settings} size={22} />
          <BrandName settings={settings} />
        </span>

        {state === "done" ? (
          <>
            <span className="unsubicon good"><Check size={24} /></span>
            <h1>You are unsubscribed</h1>
            <p>
              {address ? <b>{address}</b> : "That address"} will not receive any more emails from
              this sender. Nothing else is needed from you.
            </p>
          </>
        ) : (
          <>
            <span className="unsubicon bad"><AlertTriangle size={24} /></span>
            <h1>That link is not valid</h1>
            <p>
              It may have already been used, or been broken by the email client. Reply to the
              message asking to be removed and the sender is obliged to action it.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
