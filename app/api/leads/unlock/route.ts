import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enrichBusiness } from "@/lib/enrich";
import { unlockLead, hasUnlocked } from "@/lib/credits";
import { verifyAndPersist } from "@/lib/verify/persist";
import { stripeConfigured } from "@/lib/stripe";
import type { Lead, UnlockedLead } from "@/lib/types";
import { hideOwner, hasOwnerDetail } from "@/lib/lead-view";

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
    // and the mailbox actually checked, we know whether this lead is reachable, and
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

    // THE OWNER, SOCIALS AND HIRING CRAWL.
    //
    // This is the moment it is supposed to run, and until now it did not run at all.
    // lib/enrich.ts was wired only into bulk CSV enrichment, so a lead opened from the
    // dashboard never had ownerName, socials or hiring filled in. The consequence was
    // worse than thin data: /api/leads/owner only READS stored owner detail, so the
    // paid owner reveal could never return anything for anybody.
    //
    // Runs once per lead. `enrichedAt` is persisted, so re-opening a lead never
    // re-crawls the site, and a second customer opening the same business gets the
    // work already done.
    //
    // Bounded, because a slow site must not hold up a paid unlock. If the budget
    // expires the lead is delivered with whatever we had, which is exactly what the
    // customer got before this existed.
    if (lead.website && !lead.enrichedAt) {
      const budgetMs = 12_000;
      const enrichment = await Promise.race([
        enrichBusiness(lead.website, { verifyGuesses: true, businessName: lead.name }),
        new Promise<null>((r) => setTimeout(() => r(null), budgetMs)),
      ]).catch(() => null);

      if (enrichment) {
        if (enrichment.ownerName) {
          lead.ownerName = enrichment.ownerName;
          lead.ownerRole = enrichment.ownerRole;
          // Read off their own pages, not bought. The customer is told which, because
          // "their website says so" and "a database says so" are different claims.
          lead.ownerSource = "site";
        }
        if (enrichment.ownerEmail) lead.ownerEmail = enrichment.ownerEmail;
        if (Object.keys(enrichment.socials).length) lead.socials = enrichment.socials;
        if (enrichment.hiring !== null) {
          lead.hiring = enrichment.hiring;
          lead.hiringUrl = enrichment.hiringUrl;
        }
        // A business address found on a contact page beats having none at all.
        if (!lead.email && enrichment.scrapedEmail) lead.email = enrichment.scrapedEmail;
        lead.enrichedAt = new Date().toISOString();

        // Persist, so the crawl is paid for once per business rather than once per
        // person who opens it.
        await createAdminClient()
          .from("leads")
          .update({ raw: lead })
          .eq("id", row.id as string);
      }
    }

    // Demo deployments (no Stripe keys) have nothing to sell, so nothing is charged.
    if (!stripeConfigured()) {
      const open: UnlockedLead = { ...lead, locked: false, dbId: row.id as string,
        ownerAvailable: hasOwnerDetail(lead) };
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
    // Opening a lead buys the business contact and the grading, not the person.
    // The owner block is stripped here and sold separately by /api/leads/owner.
    const full: UnlockedLead = { ...hideOwner(lead), locked: false, dbId: row.id as string };
    return NextResponse.json({ status, credits: creditsLeft, lead: full });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[unlock]", msg);
    return NextResponse.json({ error: "Could not unlock this lead." }, { status: 500 });
  }
}
