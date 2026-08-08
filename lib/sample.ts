import { createAdminClient } from "./supabase/admin";
import { geocode } from "./geocode";
import { resolveNiche } from "./niche";
import { pickSources, mergeRawLeads, type RawLead } from "./sources";
import { readDiscovery, writeDiscovery, readAudits, hostKey } from "./search-cache";
import { auditWebsite } from "./audit";
import { verifyContact } from "./verify/contact";
import { scoreLead, gradePct, TIER_RANK } from "./score";
import { assessFreshness } from "./freshness";
import { describeCurrency } from "./freshness";
import { isRealWebsite } from "./website-kind";
import { mapPool } from "./pool";
import { coveredArea, searchIndex } from "./index-store";
import { DEFAULT_PLAYBOOK } from "./playbooks";
import type { Lead } from "./types";

// A REAL SEARCH, RUN BEFORE ANYONE HAS AN ACCOUNT.
//
// The landing page hero is a static mock. Every other surface in this product refuses
// to claim what it has not established, and then the first thing a visitor sees is an
// invented result set with invented grades. A prospect deciding whether to believe
// "verified, checked just now" is shown a picture of it.
//
// So this runs the actual pipeline, on their niche and their city, and shows the top
// three. It is the strongest sales asset available precisely because it cannot be
// faked: the business names are real and the visitor can check them.
//
// THIS IS A PUBLIC ENDPOINT THAT CRAWLS, which makes cost the design constraint rather
// than an afterthought. Four things bound it, and all four matter:
//
//   1. A day-long cache per niche+city, so a refresh loop costs one row read.
//   2. It reuses the product's own discovery cache, so a sample that somebody already
//      paid to discover costs nothing, and a sample warms it for the next customer.
//   3. Free verification only. No Twilio, no ZeroBounce: nothing here is billed to us
//      per lead, because nobody has paid for these.
//   4. Small budgets. Three leads shown, a handful of sites audited, hard deadlines.
//
// WHAT IT WILL NOT RETURN: phone, email, or the need signals. That is the paid product.
// The redaction is done here rather than in the route, so the endpoint cannot be made
// laxer by a later edit somewhere else.

/** How many leads a visitor sees. Three makes the ranking point; a fourth is filler. */
export const SAMPLE_LEADS = 3;

/** How many businesses to discover. Enough to rank honestly, not enough to be costly. */
const SAMPLE_DISCOVER = 30;

/** Sites to audit. Only the busiest, since they are the ones that will rank. */
const SAMPLE_AUDITS = 8;

/** How long a computed sample is served before being recomputed. */
const SAMPLE_TTL_HOURS = 24;

/** Wall clock for the whole thing. A landing page cannot wait 30 seconds. */
const SAMPLE_BUDGET_MS = 14_000;

/**
 * One row of the sample, and the complete list of what is safe to show.
 *
 * Mirrors LockedLead in lib/types.ts deliberately: the product already has an audited
 * definition of "what a person who has not paid may see", and inventing a second one
 * for the marketing page is how the two drift until the public one is laxer.
 */
export type SampleLead = {
  name: string;
  category: string;
  city: string;
  tier: Lead["tier"];
  grade: number;
  /** How many graded findings there are, NOT what they are. */
  signalCount: number;
  /** Verified reachable contact exists. Not which channel, and not its value. */
  deliverable: boolean;
  /** "Checked by us, 2 minutes ago", the claim a cached database cannot make. */
  currencyLabel: string;
  currencyIsOurCheck: boolean;
  /** Do they have a site of their own? The one need signal that is also a fact
   *  anybody can confirm in a browser, so showing it gives nothing away. */
  hasWebsite: boolean;
};

export type SampleResult = {
  niche: string;
  location: string;
  /** Where we actually searched, which may not be what they typed. */
  area: string;
  leads: SampleLead[];
  /** Total businesses discovered. The three shown are the top of a real list. */
  found: number;
  /** Served from a previous run rather than crawled now. */
  cached: boolean;
};

/**
 * The currency line, preferring OUR check over the listing date.
 *
 * describeCurrency prefers the listing and falls back to our crawl, which is right
 * inside the product: the listing date is a real fact about the business record.
 *
 * It is wrong here, and measurably so. A live run put "EVERYDAYPLUMBER.com" at the top
 * of the hero reading "listing updated 8 years, 7 mo ago" — on a page whose entire
 * argument is that our data is current, and about a business whose website we had
 * fetched and read that morning. The eight-year-old fact was true and the recent one
 * was truer.
 *
 * So when we have actually looked, we say so. This is not a softer claim than the
 * listing date, it is a stronger one: an OpenStreetMap edit is somebody else's record
 * of the business, and our crawl is us confirming the business is there today.
 */
function currencyFor(l: Lead): { label: string; fromOurCheck: boolean } {
  if (l.siteAudited && l.checkedAt) {
    const ours = describeCurrency(null, l.checkedAt);
    if (ours.fromOurCheck) return ours;
  }
  return describeCurrency(l.lastUpdated, l.checkedAt);
}

/** Strip a finished lead down to what a stranger may see. */
function redact(l: Lead): SampleLead {
  const currency = currencyFor(l);
  return {
    name: l.name,
    category: (l.category || "business").replace(/_/g, " "),
    city: l.city,
    tier: l.tier,
    grade: gradePct(l.score, l.scoreMax),
    signalCount: l.needSignals.length,
    deliverable: l.deliverable,
    currencyLabel: currency.label,
    currencyIsOurCheck: currency.fromOurCheck,
    hasWebsite: l.hasWebsite,
  };
}

function rawToLead(r: RawLead): Lead {
  const fresh = assessFreshness(r.lastUpdated);
  return {
    id: `${r.source}:${r.sourceId}`,
    name: r.name, category: r.category, phone: r.phone, website: r.website,
    email: r.email, address: r.address, city: r.city, lat: r.lat, lon: r.lon,
    mapUrl: r.mapUrl,
    hasWebsite: isRealWebsite(r.website),
    websiteKnown: r.websiteKnown,
    socialOnly: Boolean(r.website) && !isRealWebsite(r.website),
    siteAudited: false, siteReachable: null, hasBooking: null,
    rating: r.rating, reviewCount: r.reviewCount, hasHours: r.hasHours,
    hasSSL: null, mobileFriendly: null, copyrightYear: null, outdated: null,
    loadMs: null, hasSchema: null, hasAnalytics: null, wordCount: null,
    scriptCount: null, vendors: null,
    lastUpdated: r.lastUpdated,
    freshness: fresh.level, freshnessAgeDays: fresh.ageDays, freshnessLabel: fresh.ageLabel,
    checkedAt: null, source: r.source,
    phoneValid: null, phoneType: null, phoneE164: "", emailStatus: "unknown",
    businessStatus: r.businessStatus, activeStatus: null,
    deliverable: false, contactVerifiedAt: null,
    score: 0, scoreMax: 0, tier: "COOL", scoreFactors: [], needSignals: [], pitch: "",
  };
}

/**
 * Is this a business name, or is it a description somebody typed into OpenStreetMap?
 *
 * Measured, not imagined: the first live run of this endpoint put a listing named
 * "Dentist in Austin." at the top of the hero. OSM is contributor-maintained and a
 * minority of entries are captioned rather than named. Inside the product that costs
 * nothing, because a rep reads the address and moves on. On the landing page it is the
 * first business a prospect ever sees from us.
 *
 * Deliberately narrow. It rejects the shapes that are unambiguously not names, and
 * lets everything else through, because a real business wrongly hidden is worse than
 * an odd one shown: a visitor who searches their own town and cannot find the shop
 * they know is there has learned something false about our coverage.
 */
export function looksLikeABusinessName(raw: string): boolean {
  const name = raw.trim();
  if (name.length < 3 || name.length > 90) return false;

  // "Dentist in Austin.", "Coffee shop in Portland" — a category and a place, which is
  // what the search asked for rather than what any business calls itself.
  if (/^[a-z\s]+\s+in\s+[A-Z][a-z]/.test(name)) return false;
  if (/\bin\s+[A-Z][a-zA-Z]+\.?$/.test(name) && name.split(/\s+/).length <= 5) {
    // Only when the leading words are generic. "Bank in the Park" is a real pub name.
    const head = name.split(/\s+in\s+/)[0].toLowerCase();
    if (/^(a |an |the )?[a-z\s&'-]+$/.test(head) && head.split(/\s+/).length <= 3) return false;
  }
  // Bare punctuation or a lone symbol.
  if (!/[a-zA-Z0-9]/.test(name)) return false;
  return true;
}

/** The cache key, borrowed from the product's own normaliser so the two agree. */
function key(niche: string, location: string): string {
  const clean = (v: string) =>
    v.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  return `${clean(niche)}|${clean(location)}`;
}

/** A previously computed sample, if it is still fresh enough to serve. */
async function readCache(k: string): Promise<SampleResult | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("sample_searches")
      .select("niche, location, area, leads, found, created_at")
      .eq("key", k)
      .maybeSingle();
    if (error || !data) return null;

    const ageH = (Date.now() - new Date(data.created_at as string).getTime()) / 3_600_000;
    if (ageH > SAMPLE_TTL_HOURS) return null;

    return {
      niche: data.niche as string,
      location: data.location as string,
      area: (data.area as string) ?? (data.location as string),
      leads: data.leads as unknown as SampleLead[],
      found: (data.found as number) ?? 0,
      cached: true,
    };
  } catch {
    // A cache we cannot read costs a crawl, never the request.
    return null;
  }
}

async function writeCache(k: string, r: SampleResult): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("sample_searches").upsert(
      {
        key: k,
        niche: r.niche,
        location: r.location,
        area: r.area,
        leads: r.leads as unknown as Record<string, unknown>[],
        found: r.found,
        created_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
  } catch (e) {
    console.error("[sample] cache write failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * A previously computed sample, without running anything.
 *
 * Exported so the route can answer from cache BEFORE counting a rate limit. A cached
 * sample costs one row read, so charging a visitor's quota for it would make the
 * landing page stop working for exactly the queries it serves best.
 */
export async function sampleFromCache(
  nicheRaw: string,
  locationRaw: string
): Promise<SampleResult | null> {
  const niche = nicheRaw.trim().slice(0, 80);
  const location = locationRaw.trim().slice(0, 80);
  if (!niche || !location) return null;
  return readCache(key(niche, location));
}

export type SampleError = { error: string; code: "no_location" | "no_results" };

/**
 * Run a sample search. Returns the redacted result, or a reason it could not.
 *
 * Never throws: this is the first thing a visitor touches, and an exception here is a
 * broken landing page rather than a failed search.
 */
export async function runSample(
  nicheRaw: string,
  locationRaw: string
): Promise<SampleResult | SampleError> {
  const niche = nicheRaw.trim().slice(0, 80);
  const location = locationRaw.trim().slice(0, 80);
  if (!niche || !location) return { error: "Tell us a business type and a place.", code: "no_location" };

  const k = key(niche, location);
  const hit = await readCache(k);
  if (hit) return hit;

  const deadline = Date.now() + SAMPLE_BUDGET_MS;

  try {
    const area = await geocode(location);
    if (!area) {
      return { error: `We could not find "${location}". Try a city and state.`, code: "no_location" };
    }

    const resolved = resolveNiche(niche);
    const sources = pickSources();

    // The product's own discovery cache. A sample for a city somebody already paid to
    // search costs nothing, and a sample warms the cache for the next customer, so the
    // two halves of the funnel subsidise each other rather than duplicating work.
    // The owned index first, where we hold the area. Same preference order as the
    // real search, and the same fallback: anything we do not hold goes live.
    const covered = await coveredArea(area);
    const indexedOsm = covered ? await searchIndex(resolved.filters, area, SAMPLE_DISCOVER) : null;

    const cached = await readDiscovery(niche, location);
    const cachedOsm = cached?.leads ?? [];

    const lists = await Promise.all(
      sources.map((s) =>
        s.name === "osm" && indexedOsm
          ? Promise.resolve(indexedOsm)
          : s.name === "osm" && cachedOsm.length > 0 && !cached?.stale
          ? Promise.resolve(cachedOsm)
          : Promise.race([
              s.search({
                filters: resolved.filters,
                nicheLabel: resolved.label,
                query: niche,
                area,
                limit: SAMPLE_DISCOVER,
              }),
              new Promise<RawLead[]>((r) => setTimeout(() => r([]), 8_000)),
            ]).catch(() => [] as RawLead[])
      )
    );

    const merged = mergeRawLeads(lists);
    if (merged.length === 0) {
      return {
        error: `We could not find ${niche} in ${area.displayName}. Try a bigger city, or a broader business type.`,
        code: "no_results",
      };
    }

    const freshOsm = indexedOsm ? [] : lists.flat().filter((l) => l.source === "osm");
    if (freshOsm.length > 0 && (!cachedOsm.length || cached?.stale)) {
      void writeDiscovery(niche, location, freshOsm);
    }

    const leads = merged.map(rawToLead);

    // Audit only the busiest handful. They are the ones that will rank, and every
    // extra crawl on an unauthenticated endpoint is cost somebody else can trigger.
    const withSite = leads
      .filter((l) => l.hasWebsite && l.website)
      .sort((a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0))
      .slice(0, SAMPLE_AUDITS);

    const auditCache = await readAudits(withSite.map((l) => hostKey(l.website) ?? "").filter(Boolean));
    const toCrawl = withSite.filter((l) => {
      const host = hostKey(l.website);
      const hit2 = host ? auditCache.byHost.get(host) : undefined;
      if (hit2 && host && !auditCache.staleHosts.includes(host)) {
        l.siteAudited = true;
        l.checkedAt = auditCache.crawledAt.get(host) ?? new Date().toISOString();
        l.siteReachable = hit2.reachable;
        l.hasSSL = hit2.hasSSL;
        l.mobileFriendly = hit2.mobileFriendly;
        l.outdated = hit2.outdated;
        l.loadMs = hit2.loadMs;
        l.hasSchema = hit2.hasSchema;
        l.hasAnalytics = hit2.hasAnalytics;
        l.wordCount = hit2.wordCount;
        l.vendors = hit2.vendors;
        return false;
      }
      return true;
    });

    const auditDeadline = Math.min(Date.now() + 6_000, deadline);
    await mapPool(toCrawl, 8, async (lead) => {
      if (Date.now() > auditDeadline) return;
      const audit = await auditWebsite(lead.website, auditDeadline);
      if (!audit) return;
      lead.siteAudited = true;
      lead.checkedAt = new Date().toISOString();
      lead.siteReachable = audit.reachable;
      lead.hasSSL = audit.hasSSL;
      lead.mobileFriendly = audit.mobileFriendly;
      lead.outdated = audit.outdated;
      lead.loadMs = audit.loadMs;
      lead.hasSchema = audit.hasSchema;
      lead.hasAnalytics = audit.hasAnalytics;
      lead.wordCount = audit.wordCount;
      lead.vendors = audit.vendors;
    });

    // FREE TIER ONLY. Nobody has paid for these, so nothing here may cost us per lead.
    await mapPool(leads, 12, async (lead) => {
      if (Date.now() >= deadline) return;
      await verifyContact(lead, "free");
    });

    for (const lead of leads) {
      const s = scoreLead(lead, DEFAULT_PLAYBOOK);
      lead.score = s.score;
      lead.scoreMax = s.scoreMax;
      lead.tier = s.tier;
      lead.scoreFactors = s.factors;
      lead.needSignals = s.signals;
      lead.pitch = s.pitch;
    }

    const reachable = leads.filter((l) => l.phone || l.website || l.email);

    // WHAT THE SAMPLE SHOWS, AND WHY IT IS NOT THE PRODUCT'S OWN RANKING.
    //
    // Measured on the first real run of this endpoint, "dentists in Austin" returned,
    // in order: a listing literally named "Dentist in Austin." with no website, then
    // two businesses whose freshness line read "listing updated 6 years ago". Every
    // one of them was a correct result and the set was a terrible advertisement,
    // because none of them demonstrated the thing being sold. We had checked nothing
    // about any of them: no website to read, so no crawl, so no evidence.
    //
    // The sample's job is not to be the top of the list. It is to show the product
    // WORKING, and the product works by looking at things. So a lead we actually
    // audited outranks one we merely found, and the interface says so rather than
    // implying these are simply the best three.
    //
    // This is a display choice, not a flattering one: the leads promoted here are the
    // ones a visitor can most easily check for themselves, which is the opposite of
    // cherry-picking.
    const ranked = reachable
      .filter((l) => looksLikeABusinessName(l.name))
      .sort(
        (a, b) =>
          // Did we look at their site? That is the demonstration.
          Number(b.siteAudited && b.siteReachable !== false) -
            Number(a.siteAudited && a.siteReachable !== false) ||
          Number(b.deliverable) - Number(a.deliverable) ||
          TIER_RANK[b.tier] - TIER_RANK[a.tier] ||
          gradePct(b.score, b.scoreMax) - gradePct(a.score, a.scoreMax) ||
          a.id.localeCompare(b.id)
      );

    if (ranked.length === 0) {
      return {
        error: `We found ${merged.length} ${niche} in ${area.displayName} but none with a way to reach them. Try a bigger city.`,
        code: "no_results",
      };
    }

    const result: SampleResult = {
      niche,
      location,
      area: area.displayName,
      leads: ranked.slice(0, SAMPLE_LEADS).map(redact),
      found: ranked.length,
      cached: false,
    };

    await writeCache(k, result);
    return result;
  } catch (e) {
    console.error("[sample] failed:", e instanceof Error ? e.message : e);
    return { error: "That search did not finish. Please try again.", code: "no_results" };
  }
}
