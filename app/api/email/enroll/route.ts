import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUnlockedKeys } from "@/lib/credits";
import { stripeConfigured } from "@/lib/stripe";
import { suppressedAmong } from "@/lib/email/suppression";
import { unsubscribeToken } from "@/lib/email/compose";
import { tokenSecret } from "@/lib/email/send";
import type { Lead } from "@/lib/types";
import { toolsGate } from "@/lib/tools-gate";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  sequenceId: z.string().uuid(),
  leadIds: z.array(z.string().uuid()).min(1).max(500),
});

// Put leads into a sequence.
//
// FREE, like the CRM push: the credit was spent when the lead was opened, and charging
// again to email it would be charging twice for the same business.
//
// Four things are refused here rather than at send time, because a person watching a
// screen can act on a reason and a nightly cron cannot:
//   * a lead that is not open yet, which has no contact details to use
//   * a lead with no email address
//   * an address already on the suppression list
//   * a lead already in this sequence
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
    const gate = await toolsGate(user.id);
    if (gate) return gate;

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const admin = createAdminClient();
    const { data: seq } = await admin
      .from("email_sequences")
      .select("id, status")
      .eq("id", parsed.data.sequenceId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!seq) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data: rows } = await admin
      .from("leads")
      .select("id, source, source_id, raw")
      .eq("user_id", user.id)
      .in("id", parsed.data.leadIds);

    const owned = stripeConfigured() ? await getUnlockedKeys(user.id) : null;

    type Candidate = { leadId: string; leadKey: string; email: string; name: string };
    const candidates: Candidate[] = [];
    const reasons = { notOpened: 0, noEmail: 0 };

    for (const r of rows ?? []) {
      const lead = r.raw as unknown as Lead | null;
      if (!lead) continue;
      const leadKey = `${r.source}:${r.source_id}`;
      if (owned && !owned.has(leadKey)) { reasons.notOpened++; continue; }
      const email = (lead.ownerEmail || lead.email || "").trim();
      if (!email) { reasons.noEmail++; continue; }
      candidates.push({ leadId: r.id as string, leadKey, email, name: lead.ownerName || lead.name });
    }

    const suppressed = await suppressedAmong(user.id, candidates.map((c) => c.email));
    const allowed = candidates.filter((c) => !suppressed.has(c.email.toLowerCase()));
    const suppressedCount = candidates.length - allowed.length;

    if (allowed.length === 0) {
      return NextResponse.json({
        enrolled: 0,
        skipped: { ...reasons, suppressed: suppressedCount, alreadyIn: 0 },
        error: "None of those can be emailed. Open them first, and check they have an address.",
      }, { status: 409 });
    }

    // The id is generated here so the unsubscribe token can be derived from it. A
    // message must never be able to exist without a way out of it.
    const rowsToInsert = allowed.map((c) => {
      const id = randomUUID();
      return {
        id,
        user_id: user.id,
        sequence_id: parsed.data.sequenceId,
        lead_key: c.leadKey,
        lead_id: c.leadId,
        to_email: c.email,
        to_name: c.name,
        status: "active",
        last_step: 0,
        // Due immediately when the sequence is running, otherwise it waits for start.
        next_run_at: seq.status === "active" ? new Date().toISOString() : null,
        unsubscribe_token: unsubscribeToken(id, tokenSecret()),
      };
    });

    // ignoreDuplicates so enrolling the same list twice adds the new ones and leaves
    // the existing ones exactly where they are in the sequence.
    const { data: inserted } = await admin
      .from("email_enrollments")
      .upsert(rowsToInsert, { onConflict: "sequence_id,lead_key", ignoreDuplicates: true })
      .select("id");

    const enrolled = inserted?.length ?? 0;
    return NextResponse.json({
      enrolled,
      skipped: {
        ...reasons,
        suppressed: suppressedCount,
        alreadyIn: allowed.length - enrolled,
      },
    });
  } catch (e) {
    console.error("[enroll]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not enrol those leads." }, { status: 500 });
  }
}
