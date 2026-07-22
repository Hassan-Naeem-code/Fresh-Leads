import { NextRequest, NextResponse } from "next/server";
import { geocode } from "@/lib/geocode";
import { resolveNiche } from "@/lib/niche";
import { auditWebsite } from "@/lib/audit";
import { scoreLead, gradePct, TIER_RANK } from "@/lib/score";
import { assessFreshness } from "@/lib/freshness";
import type { Lead, ResultLead, SearchResult } from "@/lib/types";
import { viewLead } from "@/lib/lead-view";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccess, type Access } from "@/lib/access";
import { getUnlockedKeys } from "@/lib/credits";
import { problemFactors, problemById } from "@/lib/problems";
import { isRealWebsite } from "@/lib/website-kind";
import { DEFAULT_PLAYBOOK, playbookById, type PlaybookId } from "@/lib/playbooks";
import { stripeConfigured } from "@/lib/stripe";
import { pickSources, mergeRawLeads, type RawLead } from "@/lib/sources";
import { verifyContact } from "@/lib/verify/contact";
import { mapPool } from "@/lib/pool";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * How long the website-audit stage may run. Sized to leave room inside
 * maxDuration for discovery, verification, scoring and the history write, so a
 * slow batch of websites degrades gracefully instead of killing the request.
 */
const AUDIT_BUDGET_MS = 28_000;

// Build a Lead skeleton from a source RawLead, audit + verification fill the rest.
function rawToLead(r: RawLead): Lead {
  const fresh = assessFreshness(r.lastUpdated);
  return {
    id: `${r.source}:${r.sourceId}`,
    name: r.name,
    category: r.category,
    phone: r.phone,
    website: r.website,
    email: r.email,
    address: r.address,
    city: r.city,
    lat: r.lat,
    lon: r.lon,
    mapUrl: r.mapUrl,
    // Only a site of their own counts as "they have a website". A Facebook page or a
    // DoorDash listing is a different, and more sellable, situation.
    hasWebsite: isRealWebsite(r.website),
    websiteKnown: r.websiteKnown,
    socialOnly: Boolean(r.website) && !isRealWebsite(r.website),
    siteAudited: false,
    siteReachable: null,
    hasBooking: null,
    rating: r.rating,
    reviewCount: r.reviewCount,
    hasHours: r.hasHours,
    hasSSL: null,
    mobileFriendly: null,
    copyrightYear: null,
    outdated: null,
    loadMs: null,
    hasSchema: null,
    hasAnalytics: null,
    wordCount: null,
    scriptCount: null,
    vendors: null,
    lastUpdated: r.lastUpdated,
    freshness: fresh.level,
    freshnessAgeDays: fresh.ageDays,
    freshnessLabel: fresh.ageLabel,
    source: r.source,
    phoneValid: null,
    phoneType: null,
    phoneE164: "",
    emailStatus: "unknown",
    businessStatus: r.businessStatus,
    activeStatus: null,
    deliverable: false,
    contactVerifiedAt: null,
    score: 0,
    scoreMax: 0,
    tier: "COOL",
    scoreFactors: [],
    needSignals: [],
    pitch: "",
  };
}

// Map a finished Lead onto a row of the `leads` table. The full lead is kept in
// `raw` so the history detail view can reconstruct it exactly without re-deriving.
function leadToRow(searchId: string, userId: string, l: Lead) {
  return {
    search_id: searchId,
    user_id: userId,
    source: l.source,
    source_id: l.id.includes(":") ? l.id.split(":").slice(1).join(":") : l.id,
    name: l.name,
    category: l.category || null,
    phone: l.phone || null,
    phone_normalized: l.phoneE164 || null,
    phone_type: l.phoneType,
    phone_valid: l.phoneValid,
    website: l.website || null,
    email: l.email || null,
    email_verified_status: l.emailStatus,
    address: l.address || null,
    city: l.city || null,
    lat: l.lat,
    lon: l.lon,
    map_url: l.mapUrl || null,
    business_status: l.businessStatus,
    // rating / reviewCount / booking are NOT separate columns on purpose: the full
    // lead is stored in `raw` below, which is what the history view reconstructs
    // from, so adding signals needs no migration and no backfill.
    active_status: l.activeStatus,
    last_updated: l.lastUpdated,
    freshness: l.freshness,
    score: l.score,
    tier: l.tier,
    verification_status: l.deliverable ? "verified" : "unverifiable",
    deliverable: l.deliverable,
    verified_at: new Date().toISOString(),
    raw: l as unknown as Record<string, unknown>,
  };
}

export async function POST(req: NextRequest) {
  try {
    const {
      niche,
      location,
      limit,
      problem = "any",
      requiredFactors = [],
      playbook = DEFAULT_PLAYBOOK,
    }: {
      niche?: string;
      location?: string;
      limit?: number;
      problem?: string;
      requiredFactors?: string[];
      /** What the caller sells; decides which signals are scored and shown. */
      playbook?: PlaybookId;
    } = await req.json();
    if (!niche || !location) {
      return NextResponse.json({ error: "niche and location are required" }, { status: 400 });
    }
    let cap = Math.min(Math.max(parseInt(String(limit)) || 40, 1), 80);
    const notes: string[] = [];

    // ACCESS GATE. Two independent requirements, and BOTH are needed:
    //   * platform access, i.e. the $30/year subscription (or the free trial)
    //   * a credit balance
    //
    // The subscription includes no credits, so paying it does not by itself allow
    // searching. Running a search does not SPEND a credit, a credit is charged when a
    // specific lead is opened, but you must hold at least one to search at all.
    //
    // Which requirement is missing is reported back, so the client can prompt for the
    // right purchase instead of guessing.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let access: Access | null = null;
    if (stripeConfigured()) {
      if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

      access = await getAccess(user.id);
      if (!access.canSearch) {
        const needsSubscription = access.blockedBy === "subscription";
        return NextResponse.json(
          {
            error: needsSubscription
              ? "Your free credits are used up. Subscribe for $30/year to keep using Fresh Leads."
              : "You have no credits. Leads are five for $1, and you need at least one to search.",
            code: needsSubscription ? "subscription_required" : "credits_required",
            credits: access.credits,
          },
          { status: 402 }
        );
      }
    }

    const area = await geocode(location);
    if (!area) {
      return NextResponse.json({ error: `Couldn't find location "${location}".` }, { status: 404 });
    }

    const resolved = resolveNiche(niche);
    if (resolved.generic) notes.push("Unknown niche, matched by business name, coverage may vary.");

    // Discover from every configured source (OSM free by default; Places when keyed),
    // then merge/dedupe into one raw list.
    const sources = pickSources();
    const lists = await Promise.all(
      sources.map((s) =>
        s.search({ filters: resolved.filters, nicheLabel: resolved.label, area, limit: cap }).catch(() => [])
      )
    );
    const merged = mergeRawLeads(lists);

    // Businesses the user has seen before are deliberately NOT filtered out. With
    // permanent per-lead unlocks, one they already paid for is free to see again,
    // and hiding it would be hiding something they own.
    const leads: Lead[] = merged.map(rawToLead);

    // Audit websites (SSL/mobile/copyright + scrape a published email).
    //
    // This used to stop after the first 24 sites, which quietly broke both the
    // grade and the "search by problem" filter: leads past the cutoff kept null
    // site signals, so they earned no need points, capped out at COOL, and never
    // matched a problem chip, even when their site was the worst one in the batch.
    // Now every site gets audited, bounded by a wall-clock budget rather than a
    // lead count, with enough concurrency to finish a full 80-lead batch. Anything
    // the budget cuts off stays siteAudited:false so scoring can be honest about
    // not knowing instead of implying a clean site.
    // Social/marketplace pages are excluded: auditing facebook.com would measure
    // Facebook's HTTPS and mobile support, not the business's.
    const withSite = leads.filter((l) => l.hasWebsite && l.website);
    const auditDeadline = Date.now() + AUDIT_BUDGET_MS;
    let auditsSkipped = 0;
    await mapPool(withSite, 24, async (lead) => {
      if (Date.now() > auditDeadline) {
        auditsSkipped++;
        return;
      }
      const audit = await auditWebsite(lead.website);
      if (audit) {
        lead.siteAudited = true;
        lead.siteReachable = audit.reachable;
        lead.hasSSL = audit.hasSSL;
        lead.mobileFriendly = audit.mobileFriendly;
        lead.copyrightYear = audit.copyrightYear;
        lead.outdated = audit.outdated;
        lead.hasBooking = audit.hasBooking;
        lead.loadMs = audit.loadMs;
        lead.hasSchema = audit.hasSchema;
        lead.hasAnalytics = audit.hasAnalytics;
        lead.wordCount = audit.wordCount;
        lead.scriptCount = audit.scriptCount;
        lead.vendors = audit.vendors;
        if (!lead.email && audit.email) lead.email = audit.email;
      }
    });
    if (auditsSkipped > 0) {
      notes.push(
        `${auditsSkipped} website${auditsSkipped === 1 ? "" : "s"} could not be checked in time, ` +
          `those leads are graded on contact details only.`
      );
    }

    // Verify contact channels + active status, then set the "deliverable" gate.
    //
    // FREE TIER ONLY. The paid Twilio and ZeroBounce lookups wait until someone spends
    // a credit on the lead (app/api/leads/unlock), because we discover ~40 leads per
    // search and get paid for the few that are opened — see lib/verify/contact.ts.
    await mapPool(leads, 12, (lead) => verifyContact(lead, "free"));

    for (const lead of leads) {
      const s = scoreLead(lead, playbook);
      lead.score = s.score;
      lead.scoreMax = s.scoreMax;
      lead.tier = s.tier;
      lead.scoreFactors = s.factors;
      lead.needSignals = s.signals;
      lead.pitch = s.pitch;
    }

    // Only keep ACTIONABLE leads, you must be able to reach them at all.
    const actionable = leads.filter((l) => l.phone || l.website || l.email);
    const dropped = leads.length - actionable.length;
    if (dropped > 0) notes.push(`${dropped} unreachable listings (no phone/site/email) were filtered out.`);

    // PROBLEM FILTER, applied server-side. A locked lead does not carry its need
    // signals to the browser, so the client cannot do this filtering any more, and
    // doing it here is better regardless: it selects from everything discovered
    // rather than from the already-capped page.
    let matching = actionable;
    const wantedFactors = new Set([...problemFactors(problem), ...requiredFactors]);
    if (wantedFactors.size > 0) {
      const before = matching.length;
      matching = matching.filter((l) => l.scoreFactors.some((f) => wantedFactors.has(f.key)));
      const cut = before - matching.length;
      if (cut > 0) {
        const label = problemById(problem)?.label?.replace(/^…/, "") ?? "your filter";
        notes.push(`${cut} lead${cut === 1 ? "" : "s"} did not match ${label.trim()} and were left out.`);
      }
    }

    // Rank: reachable first, then TIER, then grade within the tier.
    //
    // Tier has to come before the percentage. A lead we could learn nothing about has a
    // ceiling of just phone + email, so having both scores 100% and used to outrank a
    // genuinely Hot lead at 86%. Tier already encodes whether there is real evidence.
    matching.sort(
      (a, b) =>
        Number(b.deliverable) - Number(a.deliverable) ||
        TIER_RANK[b.tier] - TIER_RANK[a.tier] ||
        gradePct(b.score, b.scoreMax) - gradePct(a.score, a.scoreMax)
    );
    const top = matching.slice(0, cap);

    const genuine = top.filter((l) => l.deliverable).length;
    // "Contact found", not "verified": only the free checks have run at this point. The
    // carrier and mailbox lookups fire when a lead is opened, and the promise attached
    // to that is the one worth stating — nobody pays for a lead that fails it.
    notes.push(
      `${genuine} of ${top.length} leads have a contact we can reach and look open. ` +
        `We confirm the phone and mailbox live when you open one, and you are not charged if it fails.`
    );

    const scannedAt = new Date().toISOString();
    const matchedTags = [resolved.label, ...sources.map((s) => s.name)];
    notes.push(`Graded for: ${playbookById(playbook).label.toLowerCase()}.`);

    // Persist the search + its leads BEFORE responding. This is no longer just
    // history: unlocking reads the full lead back from this row, so a lead that was
    // never saved can never be unlocked. Failures are still non-fatal (the user
    // keeps their results) but they are logged loudly and the response says the
    // leads are not unlockable, rather than offering an unlock that would fail.
    let searchId: string | null = null;
    const rowIdByLeadId = new Map<string, string>();
    if (user && top.length > 0) {
      try {
        const admin = createAdminClient();
        const { data: saved, error: searchErr } = await admin
          .from("searches")
          .insert({
            user_id: user.id,
            niche,
            location,
            resolved_area: area.displayName,
            matched_tags: matchedTags,
            notes,
            status: "complete",
            scanned_at: scannedAt,
          })
          .select("id")
          .single();
        if (searchErr) throw new Error(searchErr.message);
        searchId = saved?.id ?? null;

        if (searchId) {
          const { data: rows, error: leadsErr } = await admin
            .from("leads")
            .insert(top.map((l) => leadToRow(searchId!, user.id, l)))
            .select("id, source, source_id");
          if (leadsErr) throw new Error(leadsErr.message);
          for (const r of rows ?? []) {
            rowIdByLeadId.set(`${r.source}:${r.source_id}`, r.id as string);
          }
        }
      } catch (e) {
        console.error("[leads] persist failed, leads will not be unlockable:", e);
        searchId = null;
        rowIdByLeadId.clear();
        notes.push("We could not save this search, please run it again to unlock leads.");
      }
    }

    // Which of these has the user already paid for? Those come back in full, at no
    // charge, because an unlock is permanent.
    const unlocked = user ? await getUnlockedKeys(user.id) : new Set<string>();
    // Without Stripe configured there is nothing to sell, so a demo deployment
    // shows everything rather than locking the operator out of their own instance.
    const everythingOpen = !stripeConfigured();

    const resultLeads: ResultLead[] = top.map((l) =>
      viewLead(l, {
        dbId: rowIdByLeadId.get(l.id) ?? null,
        // A Lead's id IS its cross-search business key ("<source>:<source_id>").
        leadKey: l.id,
        unlockedKeys: unlocked,
        everythingOpen,
      })
    );

    const result: SearchResult = {
      niche,
      location,
      resolvedArea: area.displayName,
      matchedTags,
      count: resultLeads.length,
      leads: resultLeads,
      notes,
      scannedAt,
      credits: access?.credits ?? 0,
      searchId,
    };

    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: `Lead search failed: ${msg}` }, { status: 500 });
  }
}
