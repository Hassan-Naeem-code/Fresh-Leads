import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { unlockLead, hasUnlocked } from "@/lib/credits";
import { verifyAndPersist } from "@/lib/verify/persist";
import { stripeConfigured } from "@/lib/stripe";
import type { Lead, UnlockedLead } from "@/lib/types";

export const runtime = "nodejs";

const Body = z.object({ leadId: z.string().uuid() });

// Spend one credit to reveal a lead in full.
//
// The full record is read back from the leads row the search saved, so the
// contact details only ever leave the server for a lead that has been paid for.
// The charge itself is a single SQL function call (see unlock_lead in migration
// 006): it is the database, not this route, that guarantees a double-clicked
// button or two open tabs cannot spend two credits on the same business.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    // Load the lead with the service-role client, but scoped to this user, so one
    // account can never unlock a lead that belongs to another.
    const admin = createAdminClient();
    const { data: row } = await admin
      .from("leads")
      .select("id, user_id, search_id, source, source_id, raw")
      .eq("id", parsed.data.leadId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!row || !row.raw) {
      return NextResponse.json(
        { error: "That lead is no longer available, please run the search again." },
        { status: 404 }
      );
    }

    const leadKey = `${row.source}:${row.source_id}`;
    const lead = row.raw as unknown as Lead;

    // THE PAID VERIFICATION HAPPENS HERE, not at search time.
    //
    // The search only ran free offline checks, because it discovers ~40 leads and gets
    // paid for the few that are opened. This is the moment the lead is worth ~2c of
    // Twilio and ZeroBounce, so this is where we spend it (see lib/verify/contact.ts).
    //
    // It runs BEFORE the charge, deliberately: once the line has actually been dialled
    // and the mailbox actually checked, we know whether this lead is reachable — and
    // billing a credit for a lead we just proved unreachable would be indefensible.
    // `contactVerifiedAt` makes it a one-time cost: re-opening a lead never re-bills us.
    const alreadyOwned = await hasUnlocked(user.id, leadKey);
    await verifyAndPersist(lead, row.id as string);

    // Proven unreachable, and they do not already own it: hand it back free of charge.
    // Never charge for a lead we cannot deliver.
    if (!lead.deliverable && !alreadyOwned) {
      return NextResponse.json(
        {
          error:
            "We just re-checked this one and its phone and email are both dead, " +
            "so we haven't charged you. It's been marked unverified.",
          code: "unverifiable",
          credits: null,
        },
        { status: 409 }
      );
    }

    // Demo deployments (no Stripe keys) have nothing to sell, so nothing is charged.
    if (!stripeConfigured()) {
      const open: UnlockedLead = { ...lead, locked: false, dbId: row.id as string };
      return NextResponse.json({ status: "unlocked", credits: 0, lead: open });
    }

    const { status, creditsLeft } = await unlockLead(user.id, leadKey, {
      leadId: row.id as string,
      searchId: row.search_id as string | null,
    });

    if (status === "insufficient") {
      return NextResponse.json(
        {
          error: "You're out of credits. Top up to unlock this lead.",
          code: "insufficient_credits",
          credits: creditsLeft,
        },
        { status: 402 }
      );
    }

    // 'unlocked' (charged just now) and 'already' (paid for previously, free) both
    // return the lead. The client uses `status` only to decide whether to animate
    // the balance going down.
    const full: UnlockedLead = { ...lead, locked: false, dbId: row.id as string };
    return NextResponse.json({ status, credits: creditsLeft, lead: full });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[unlock]", msg);
    return NextResponse.json({ error: "Could not unlock this lead." }, { status: 500 });
  }
}
