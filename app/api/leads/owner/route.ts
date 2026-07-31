import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { unlockOwner, hasUnlocked } from "@/lib/credits";
import { hasOwnerDetail, OWNER_FIELDS } from "@/lib/lead-view";
import { stripeConfigured } from "@/lib/stripe";
import type { Lead } from "@/lib/types";

export const runtime = "nodejs";

const Body = z.object({ leadId: z.string().uuid() });

// REVEAL WHO RUNS THE BUSINESS. One credit, once, permanently.
//
// Opening a lead buys the business contact and the grading. This buys the person, the
// way Openmart prices an owner email above a business one. The reasoning is the same:
// owner detail is the expensive part to obtain and the valuable part to receive.
//
// Two rules make it defensible:
//   1. The lead must already be unlocked. Selling the owner of a business you cannot
//      otherwise see would be selling a fragment.
//   2. We must actually hold owner detail. Coverage is 38%, so most leads never offer
//      this at all, and charging for a reveal that returns nothing is indefensible.
//      Checked BEFORE the credit is taken, exactly like the contact verification gate.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const admin = createAdminClient();
    const { data: row } = await admin
      .from("leads")
      .select("id, source, source_id, raw")
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

    // Rule 1: the lead itself has to be theirs already.
    if (stripeConfigured() && !(await hasUnlocked(user.id, leadKey))) {
      return NextResponse.json(
        { error: "Open this lead first, then you can reveal who runs it.", code: "lead_locked" },
        { status: 409 }
      );
    }

    // Rule 2: never sell an empty reveal.
    if (!hasOwnerDetail(lead)) {
      return NextResponse.json(
        {
          error:
            "We could not find who runs this one, so there is nothing to reveal and " +
            "you have not been charged.",
          code: "no_owner",
        },
        { status: 409 }
      );
    }

    const owner = Object.fromEntries(
      OWNER_FIELDS.map((f) => [f, (lead as unknown as Record<string, unknown>)[f] ?? null])
    );

    // Demo deployments with no Stripe keys have nothing to sell.
    if (!stripeConfigured()) {
      return NextResponse.json({ status: "unlocked", credits: 0, owner });
    }

    const { status, creditsLeft } = await unlockOwner(user.id, leadKey, row.id as string);

    if (status === "insufficient") {
      return NextResponse.json(
        {
          error: "You need one more credit to reveal the owner.",
          code: "insufficient_credits",
          credits: creditsLeft,
        },
        { status: 402 }
      );
    }

    return NextResponse.json({ status, credits: creditsLeft, owner });
  } catch (e) {
    console.error("[owner-reveal]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not reveal the owner." }, { status: 500 });
  }
}
