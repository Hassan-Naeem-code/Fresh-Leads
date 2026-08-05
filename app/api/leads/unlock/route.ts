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
import { writeHiring, hostKey } from "@/lib/search-cache";
import { lookupRegistryOwner } from "@/lib/registry";

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
    // Only businesses whose own site never named anybody, and only where a state
    // publishes its filings properly. See lib/registry: this is deliberately biased
    // toward returning nothing, because attaching the WRONG name to a business is far
    // worse than attaching none. It is also a FALLBACK and never an override: when a
    // business says on its own pages who runs it, that beats a filing, and the two
    // genuinely disagree in the wild. Measured on real leads, one salon's site named
    // one person while the state named another; the site is the better answer.
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
          // Remembered for everyone, so this crawl is paid for once rather than once
          // per person who meets the business. Awaited, not fired and forgotten: work
          // left running after the response returns is killed on serverless, which is
          // how the first version of the search cache silently wrote nothing.
          const host = hostKey(lead.website);
          if (host) {
            await writeHiring(host, {
              hiring: enrichment.hiring,
              hiringUrl: enrichment.hiringUrl,
            });
          }
        }
        // A business address found on a contact page beats having none at all.
        if (!lead.email && enrichment.scrapedEmail) lead.email = enrichment.scrapedEmail;
        lead.enrichedAt = new Date().toISOString();
      }

      // THE STATE FILING, when their own site named nobody.
      //
      // Owner coverage is the last real gap against the big databases and it cannot be
      // bought: Hunter returned zero genuine owners across 40 local businesses, because
      // the data does not exist commercially for a pizza shop. It does exist in the
      // filing every LLC makes with its state, which is public and names a human being.
      //
      // Strictly a fallback. If the crawl above found a name on their own pages, that
      // one stands: a business saying who runs it beats a legal filing that may name an
      // accountant, and the two do disagree on real leads.
      if (!lead.ownerName) {
        const filed = await lookupRegistryOwner({
          name: lead.name,
          city: lead.city ?? "",
          address: lead.address ?? "",
        });
        if (filed) {
          lead.ownerName = filed.name;
          // Never "owner". A registered agent is who the state serves papers on, which
          // for a local business is usually but not always the person who runs it, and
          // the card says exactly that rather than the flattering version.
          lead.ownerRole = filed.role;
          lead.ownerSource = "registry";
          lead.ownerRegistry = filed.source;
          lead.enrichedAt = lead.enrichedAt ?? new Date().toISOString();
        }
      }

      // Persist, so the work is paid for once per business rather than once per person
      // who opens it.
      if (lead.enrichedAt) {
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
