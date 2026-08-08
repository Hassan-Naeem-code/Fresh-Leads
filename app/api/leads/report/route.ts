import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportLead } from "@/lib/credits";
import { isReportReason, REPORT_REASONS } from "@/lib/report-reasons";
import { guard } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Body = z.object({
  leadId: z.string().uuid(),
  reason: z.string().refine(isReportReason, "Unknown reason"),
  detail: z.string().max(2000).optional(),
});

// "THIS LEAD WAS WRONG." One click, credit back, no ticket, no argument.
//
// The guarantee printed in the footer of every page is that we never charge for a lead
// we cannot verify. app/api/leads/unlock enforces that for the leads we can prove are
// bad before the rep dials: dead phone AND dead mailbox, checked before the charge.
//
// Everything else is discovered on the phone. A number that reaches a hairdresser
// instead of the dentist passes every automated check we have, because it IS a working
// number. Until now the only recourse was a support ticket, which means the guarantee
// held only for customers willing to ask a human for it, on our timetable.
//
// So this refunds automatically. The reasoning is not generosity, it is arithmetic: a
// wrongly granted refund costs one dollar, and a customer who concludes the guarantee
// is decoration costs the account and everyone they tell. The controls that matter are
// against automation, not against customers, and they are the rate limiter below plus
// the one-report-per-business unique index in migration 031.
//
// Every report is recorded whether or not it pays out, because these are the only
// ground truth we have about our own accuracy, and lib/quality.ts reads them.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

    // Bounded per account. Not because honest customers report too much (they report
    // far less than they should) but because an automated loop must not be able to
    // walk a balance upward.
    const limited = await guard("report", user.id, "reports");
    if (limited) return limited;

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    // The lead has to be one of theirs. Reading it also gives us the stable business
    // key, which is what the refund and the report are keyed on: the same business
    // found by a later search is a different row and must not be reportable twice.
    const admin = createAdminClient();
    const { data: row } = await admin
      .from("leads")
      .select("id, source, source_id")
      .eq("id", parsed.data.leadId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!row) {
      return NextResponse.json(
        { error: "That lead is no longer available, please run the search again." },
        { status: 404 }
      );
    }

    const leadKey = `${row.source}:${row.source_id}`;
    const { status, refunded, creditsLeft } = await reportLead(
      user.id,
      leadKey,
      parsed.data.reason,
      { detail: parsed.data.detail ?? null, leadId: row.id as string }
    );

    // Every branch is a 200. None of these is an error the customer made, and a
    // failure status on "we already handled this" would render as a red box telling
    // them something went wrong when nothing did.
    const message =
      status === "refunded"
        ? refunded > 1
          ? `Thanks. ${refunded} credits are back in your balance.`
          : "Thanks. That credit is back in your balance."
        : status === "already"
          ? "You've already reported this one, and the credit went back then."
          : status === "expired"
            ? "That lead is more than 60 days old, so we can't credit it back automatically. " +
              "Message support and we'll sort it out."
            : "Thanks for telling us. You were never charged for this one, so there's nothing to refund.";

    return NextResponse.json({ status, refunded, credits: creditsLeft, message });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[report]", msg);
    return NextResponse.json({ error: "Could not file that report." }, { status: 500 });
  }
}

/** The reason codes, so the UI never hardcodes a list that can drift from the schema. */
export async function GET() {
  return NextResponse.json({ reasons: REPORT_REASONS });
}
