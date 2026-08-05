import { NextRequest, NextResponse } from "next/server";
import { geocode } from "@/lib/geocode";
import { resolveNiche } from "@/lib/niche";
import { auditWebsite, type Audit } from "@/lib/audit";
import { observeAndDiff, recentTriggers, type Trigger } from "@/lib/snapshots";
import { guard } from "@/lib/rate-limit";
import { readDiscovery, writeDiscovery, readAudits, writeAudits, readHiring, hostKey } from "@/lib/search-cache";
import { seenKeys, markSeen } from "@/lib/watchlists";
import { userIdForApiKey } from "@/lib/api-keys";
import { scoreLead, gradePct, TIER_RANK } from "@/lib/score";
import { assessFreshness } from "@/lib/freshness";
import type { Lead, ResultLead, SearchResult } from "@/lib/types";
import { viewLead } from "@/lib/lead-view";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccess, type Access } from "@/lib/access";
import { getUnlockedKeys, getOwnerUnlockedKeys } from "@/lib/credits";
import { problemFactors, problemById } from "@/lib/problems";
import { isRealWebsite } from "@/lib/website-kind";
import { DEFAULT_PLAYBOOK, playbookById, type PlaybookId } from "@/lib/playbooks";
import { stripeConfigured } from "@/lib/stripe";
import { pickSources, mergeRawLeads, type RawLead } from "@/lib/sources";
import { verifyContact } from "@/lib/verify/contact";
import { mapPool } from "@/lib/pool";
import { FREE_PREVIEW_LEADS } from "@/lib/pricing";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * How long the website-audit stage may run. Sized to leave room inside
 * maxDuration for discovery, verification, scoring and the history write, so a
 * slow batch of websites degrades gracefully instead of killing the request.
 */
const AUDIT_BUDGET_MS = 18_000;

/**
 * The whole request's budget, a margin inside maxDuration.
 *
 * Sized from measurement, not taste. With the earlier numbers a search for personal
 * injury lawyers in Austin came back in 58 seconds against a 60 second limit, which is
 * a pass by two seconds and not a pass at all. The stages AFTER the budget still cost
 * real time: scoring every lead, filtering, and writing forty rows with their full
 * payload. This leaves room for them.
 *
 * Without this, a slow area ran past the platform's 60 second limit and the function
 * was killed mid-flight. The customer did not get a timeout page: they got Vercel's
 * plain text error, which the browser then tried to parse as JSON and reported as
 * "Unexpected token 'A'". Measured: one search took 185 seconds.
 *
 * Every stage after discovery checks this and degrades rather than continuing, so a
 * slow search returns fewer enriched leads instead of returning nothing at all.
 */
const REQUEST_BUDGET_MS = 30_000;

/**
 * How long the quieter re-check of unreachable sites may run, in total.
 *
 * Small on purpose. It exists to correct a minority of leads, and every second it
 * spends is a second the whole search does not have.
 */
const RECHECK_BUDGET_MS = 5_000;

/**
 * Copy an audit's findings onto the lead.
 *
 * Extracted because there are now THREE places an audit arrives from: a live crawl,
 * the cache, and the quieter second pass. They were separate copies of the same
 * fifteen assignments, which is how one of them ends up missing a field that the
 * others set.
 */
function applyAudit(lead: Lead, audit: Audit, crawledAt?: string | null): void {
  lead.siteAudited = true;
  // When we looked, not when we answered. A cached audit carries the time it was
  // actually crawled, because serving one is not looking at anything.
  lead.checkedAt = crawledAt ?? new Date().toISOString();
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
    // Filled in when the site is actually fetched, or from the cache entry's own crawl
    // time. Stays null for a business with no website, where we have looked at nothing
    // and should not imply otherwise.
    checkedAt: null,
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
  // Started before anything else, so every later stage measures against the real
  // arrival time rather than against whenever its own section happened to begin.
  const requestDeadline = Date.now() + REQUEST_BUDGET_MS;
  const startedAt = Date.now();
  // Stage timings, returned with the result.
  //
  // Budgets were being tuned by guessing which stage was slow, tightening it, and
  // measuring the total again. That found the audit and the re-check and then stopped
  // working, because the remaining cost was spread across stages nobody was timing.
  const timings: Record<string, number> = {};
  const mark = (stage: string) => { timings[stage] = Date.now() - startedAt; };
  try {
    const {
      niche,
      location,
      limit,
      offset,
      problem = "any",
      requiredFactors = [],
      playbook = DEFAULT_PLAYBOOK,
      watchlistId,
      minRating,
      minReviews,
      webPresence = "any",
    }: {
      niche?: string;
      location?: string;
      limit?: number;
      /** Where in the ranking to start, so a customer can go past the first page. */
      offset?: number;
      problem?: string;
      requiredFactors?: string[];
      /** What the caller sells; decides which signals are scored and shown. */
      playbook?: PlaybookId;
      /** Scope this run to a watched market, so results can be flagged as new. */
      watchlistId?: string;
      /** Ideal-customer filters, the size and quality bars every competitor offers. */
      minRating?: number;
      minReviews?: number;
      webPresence?: "any" | "none" | "social_only" | "has_site";
    } = await req.json();
    if (!niche || !location) {
      return NextResponse.json({ error: "niche and location are required" }, { status: 400 });
    }
    let cap = Math.min(Math.max(parseInt(String(limit)) || 40, 1), 80);
    // Where to start. Bounded because it decides an array slice and because the
    // ranking below it has to have been computed anyway: asking for lead 10,000 costs
    // exactly as much as asking for lead 1 and returns nothing.
    const from = Math.min(Math.max(parseInt(String(offset)) || 0, 0), 500);
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
    // TWO WAYS IN, ONE IMPLEMENTATION. The dashboard sends a session cookie; a
    // programmatic caller sends an API key. Everything after this point is identical,
    // which is the point: a second copy of "what is a lead" would drift, and the copy
    // nobody watches would drift first.
    const supabase = await createClient();
    const {
      data: { user: cookieUser },
    } = await supabase.auth.getUser();

    let user: { id: string } | null = cookieUser ? { id: cookieUser.id } : null;
    if (!user) {
      const apiUserId = await userIdForApiKey(req.headers.get("authorization"));
      if (apiUserId) user = { id: apiUserId };
    }

    // A search fans out to dozens of crawls and third party lookups, so it is the most
    // expensive thing anyone can ask for. Keyed by account: an API key holder paying
    // per lead still should not be able to melt the crawler with a loop.
    if (user) {
      const limited = await guard("search", user.id, "searches");
      if (limited) return limited;
    }

    let access: Access | null = null;
    if (stripeConfigured()) {
      if (!user) {
        return NextResponse.json(
          { error: "Please sign in, or send an API key as Authorization: Bearer fl_live_..." },
          { status: 401 }
        );
      }

      access = await getAccess(user.id);
      if (!access.canSearch) {
        const needsSubscription = access.blockedBy === "subscription";
        return NextResponse.json(
          {
            error: needsSubscription
              ? "Your free credits are used up. Subscribe for $30/year to keep using Fresh Leads."
              : "You have no credits. Credits are $1 each, and you need at least one to search.",
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

    // CACHE. Which businesses are in an area is the same answer for everybody, and
    // finding out costs the slowest stage of the search. A hit removes it entirely.
    //
    // Google Places is still called live on every search: their terms permit storing
    // place_id and coordinates and nothing else, so only the OSM half is cached. That
    // is a real cost knowingly paid.
    // Collected and awaited before the response goes out. See the note where they are
    // flushed: a promise left running on a serverless function is a promise that gets
    // frozen mid write.
    const cacheWrites: Promise<void>[] = [];

    const cached = await readDiscovery(niche, location);
    const cachedOsm = cached?.leads ?? [];
    if (cached) {
      console.log(
        `[cache] discovery hit for "${niche} / ${resolved.label}", ${cachedOsm.length} businesses, ${cached.ageHours}h old${cached.stale ? ", stale" : ""}`
      );
    }

    // Discovery gets a ceiling too. Overpass asks for a 25 second server side timeout
    // but nothing stopped a slow response from spending far longer than that here, and
    // discovery running long leaves no room for anything after it. A source that does
    // not answer in time contributes nothing rather than sinking the whole search: with
    // two sources configured, one slow one still leaves the other's results.
    const DISCOVERY_BUDGET_MS = 11_000;
    const lists = await Promise.all(
      sources.map((s) =>
        // A fresh cache entry answers for OSM, so only Places is asked. A stale entry
        // is still SERVED, and refreshed below, rather than making this customer wait
        // for the crawl the cache exists to avoid.
        s.name === "osm" && cachedOsm.length > 0 && !cached?.stale
          ? Promise.resolve(cachedOsm)
          : Promise.race([
          s.search({ filters: resolved.filters, nicheLabel: resolved.label, area, limit: cap }),
          new Promise<RawLead[]>((resolve) =>
            setTimeout(() => {
              console.warn(`[leads] ${s.name} did not answer within the discovery budget`);
              resolve([]);
            }, DISCOVERY_BUDGET_MS)
          ),
        ]).catch(() => [] as RawLead[])
      )
    );
    // Which source actually contributed. Production was returning leads that were
    // 100% Google Places with nothing from OpenStreetMap, while the same query from a
    // laptop returned 143 OSM rows in six seconds. That is worth seeing in the logs
    // rather than inferring from an empty cache, because the discovery cache can only
    // ever hold OSM rows and stays empty for as long as OSM contributes none.
    for (let i = 0; i < sources.length; i++) {
      console.log(`[leads] source ${sources[i].name}: ${lists[i]?.length ?? 0} rows`);
    }

    const merged = mergeRawLeads(lists);
    mark("discovery");

    // NARROWING MUST NOT MEAN EMPTY.
    //
    // "car accident law firm" now searches law firms whose name mentions it, which is
    // what was asked for and is also a much smaller set. In a town with four such
    // firms that is four leads, and a customer who typed a longer sentence should not
    // be punished with a shorter list than the person who typed less.
    //
    // So a thin narrowed result falls back to the whole category, and the narrowed
    // matches stay at the front where the scoring already puts the best fit.
    let broadened = false;
    if (resolved.qualifier && merged.length < 10 && Date.now() < requestDeadline - 18_000) {
      const broad = resolveNiche(niche.replace(new RegExp(resolved.qualifier, "ig"), "").trim() || niche);
      if (broad.filters.length && broad.filters.join() !== resolved.filters.join()) {
        const extra = await Promise.all(
          sources.map((src) =>
            Promise.race([
              src.search({ filters: broad.filters, nicheLabel: broad.label, area, limit: cap }),
              new Promise<RawLead[]>((r) => setTimeout(() => r([]), 10_000)),
            ]).catch(() => [] as RawLead[])
          )
        );
        const widened = mergeRawLeads([merged, ...extra]);
        if (widened.length > merged.length) {
          broadened = true;
          notes.push(
            `Only ${merged.length} match "${resolved.qualifier}" exactly, so the rest of the category is included below.`
          );
          merged.length = 0;
          merged.push(...widened);
        }
      }
    }
    void broadened;

    // File what OSM returned, so the next person asking this question does not wait.
    // Only written when it came from a live call: re-writing what we just read would
    // extend the expiry of data nobody re-fetched, which is how a cache quietly stops
    // being a cache and becomes a stale copy.
    const freshOsm = lists.flat().filter((l) => l.source === "osm");
    if (freshOsm.length > 0 && (!cachedOsm.length || cached?.stale)) {
      cacheWrites.push(writeDiscovery(niche, location, freshOsm));
    }

    if (merged.length === 0) {
      // Distinguishable from "this area genuinely has none": both sources timed out.
      notes.push(
        "The map data source was slow to answer, so this search may be missing businesses. Trying again usually works."
      );
    }

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
    const auditDeadline = Math.min(Date.now() + AUDIT_BUDGET_MS, requestDeadline);
    let auditsSkipped = 0;
    // Kept so the crawl can be filed as a dated observation once the batch is done.
    // Change over time is the one signal a live query cannot produce (lib/snapshots.ts).
    const auditByKey = new Map<string, Audit>();

    // CACHE. A website does not change between two people searching an hour apart, and
    // fetching one is the single most expensive thing this route does. Cached audits
    // are applied first; only the misses are actually crawled.
    //
    // Cached for a day rather than a week, because "their site is down" has to be
    // true when it is said. A day old audit is defensible and a week old one is not.
    const auditCache = await readAudits(withSite.map((l) => hostKey(l.website) ?? "").filter(Boolean));
    const toCrawl: typeof withSite = [];
    for (const lead of withSite) {
      const host = hostKey(lead.website);
      const hit = host ? auditCache.byHost.get(host) : undefined;
      // A stale entry is re-crawled rather than served: the freshness of this
      // particular fact is what the product is selling.
      if (hit && host && !auditCache.staleHosts.includes(host)) {
        auditByKey.set(lead.id, hit);
        applyAudit(lead, hit, auditCache.crawledAt.get(host) ?? null);
      } else {
        toCrawl.push(lead);
      }
    }
    if (auditCache.byHost.size > 0) {
      console.log(`[cache] ${withSite.length - toCrawl.length} of ${withSite.length} audits served from cache`);
    }

    const freshAudits: { host: string; audit: Audit }[] = [];
    await mapPool(toCrawl, 24, async (lead) => {
      if (Date.now() > auditDeadline) {
        auditsSkipped++;
        return;
      }
      const audit = await auditWebsite(lead.website, auditDeadline);
      if (audit) {
        const host = hostKey(lead.website);
        if (host) freshAudits.push({ host, audit });
        auditByKey.set(lead.id, audit);
        applyAudit(lead, audit);
      }
    });
    mark("audit_pool");
    if (auditsSkipped > 0) {
      notes.push(
        `${auditsSkipped} website${auditsSkipped === 1 ? "" : "s"} could not be checked in time, ` +
          `those leads are graded on contact details only.`
      );
    }

    // File today's crawl and pick up anything that changed since we last saw these
    // businesses. Awaited rather than fired and forgotten: work left running after the
    // response is returned gets killed on serverless, and a lost observation is a diff
    // we can never compute later. observeAndDiff swallows its own failures, so a
    // database problem here costs the signal, never the search.
    //
    // Nothing consumes these triggers yet. Snapshots have to accumulate before any
    // business has two of them, so this is storing history now to sell it later.
    // Skipped when late. Change detection is the signal nobody else can sell, and it
    // is still worth less than the search returning: a missed observation costs one
    // day of history, a timeout costs the whole result.
    const changes: Map<string, Trigger[]> =
      Date.now() < requestDeadline ? await observeAndDiff(leads, auditByKey) : new Map();
    mark("observe");
    if (changes.size > 0) {
      console.log(`[leads] ${changes.size} business${changes.size === 1 ? "" : "es"} changed since last seen`);
    }

    // Everything detected at these businesses in the last month, not only what this
    // search happened to notice. A change found on Tuesday by somebody else's search is
    // still news to whoever looks on Thursday.
    const known: Map<string, Trigger[]> =
      Date.now() < requestDeadline ? await recentTriggers(leads.map((l) => l.id)) : new Map();
    mark("triggers");
    for (const lead of leads) {
      const found = known.get(lead.id) ?? changes.get(lead.id) ?? [];
      if (found.length) lead.changes = found.map((t) => ({ kind: t.kind, label: t.label, since: t.since }));
    }

    // SECOND PASS on anything that came back unreachable.
    //
    // The first pass runs 24 audits at once, each fetching a homepage and several
    // subpages. Under that much contention a 4 second timeout fails sites that are
    // perfectly healthy: measured on a real batch, one site in ten marked "down"
    // answered in 90ms when asked on its own.
    //
    // That is the most damaging wrong output this product can produce. A rep opens
    // the call with "I noticed your website is down" about a site the owner can see
    // working, and the credibility of every other claim goes with it.
    //
    // So the losers are re-audited quietly, three at a time instead of 24. They are a
    // minority of any batch, the cap keeps the worst case bounded, and a site that
    // fails BOTH passes is genuinely unreachable.
    const unreachable = withSite.filter((l) => auditByKey.get(l.id)?.reachable === false);
    // Skipped entirely when the request is already late. It improves accuracy on a
    // minority of leads; finishing at all matters more.
    //
    // BOUNDED, and this is why: as first written it had no deadline of its own. Up to
    // fifteen sites, three at a time, and a single audit can spend 27 seconds across
    // its four attempts, so the worst case was over two minutes AFTER the audit stage
    // had already used its 28. "restaurants in Austin" hit the platform's 60 second
    // limit and returned a plain text error; "dentists in Austin" finished in 36 and
    // looked fine. The difference was how many sites failed the first pass.
    const recheckDeadline = Math.min(Date.now() + RECHECK_BUDGET_MS, requestDeadline - 6_000);
    if (unreachable.length > 0 && Date.now() < recheckDeadline) {
      const recheck = unreachable.slice(0, 15);
      await mapPool(recheck, 3, async (lead) => {
        // Checked per lead, not just once at the top: the whole point is that any one
        // of these can be slow, so the budget has to be re-read as the queue drains.
        if (Date.now() >= recheckDeadline) return;
        const second = await auditWebsite(lead.website, recheckDeadline);
        // Only ACCEPT a better answer. A second failure changes nothing, so a site
        // that is genuinely down keeps its verdict and its already-correct fields.
        if (!second?.reachable) return;
        auditByKey.set(lead.id, second);
        applyAudit(lead, second);
        const host = hostKey(lead.website);
        // The corrected verdict replaces the wrong one in the cache, so the next
        // search does not repeat the mistake this pass just fixed.
        if (host) freshAudits.push({ host, audit: second });
      });
      const recovered = recheck.filter((l) => auditByKey.get(l.id)?.reachable).length;
      if (recovered > 0) {
        console.log(`[leads] ${recovered} of ${recheck.length} "unreachable" sites answered on a quieter retry`);
      }
    }

    mark("recheck");
    // HIRING, from whoever paid to discover it.
    //
    // Not crawled here: finding it means fetching a careers page per business and this
    // request already runs 40 audits inside a 60 second function. It is learned at
    // unlock and remembered, so coverage compounds as the product is used rather than
    // being rediscovered for every customer who meets the same business.
    if (Date.now() < requestDeadline) {
      const hiring = await readHiring(withSite.map((l) => hostKey(l.website) ?? "").filter(Boolean));
      if (hiring.size > 0) {
        for (const lead of withSite) {
          const fact = hiring.get(hostKey(lead.website) ?? "");
          if (!fact) continue;
          lead.hiring = fact.hiring;
          lead.hiringUrl = fact.hiringUrl;
        }
        console.log(`[cache] hiring known for ${hiring.size} of ${withSite.length} businesses`);
      }
    }
    mark("hiring");

    // File everything crawled this run, so the next search skips it.
    if (freshAudits.length > 0) cacheWrites.push(writeAudits(freshAudits));
    mark("audits");

    // Verify contact channels + active status, then set the "deliverable" gate.
    //
    // FREE TIER ONLY. The paid Twilio and ZeroBounce lookups wait until someone spends
    // a credit on the lead (app/api/leads/unlock), because we discover ~40 leads per
    // search and get paid for the few that are opened, see lib/verify/contact.ts.
    await mapPool(leads, 12, async (lead) => {
      // Late arrivals keep the offline checks already done at discovery rather than
      // holding the whole response open for one more lookup.
      if (Date.now() >= requestDeadline) return;
      await verifyContact(lead, "free");
    });

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

    // IDEAL CUSTOMER FILTERS: size and quality bars, applied before the cap so they
    // select from everything discovered rather than from an already-trimmed page.
    //
    // Rating and review count come from Google Places. OpenStreetMap does not carry
    // them, so a lead sourced only from OSM has them as null. A null is EXCLUDED when
    // a bar is set, because we cannot claim it clears a bar we never measured, but the
    // count of those is reported rather than swallowed: silently dropping half the
    // results for missing data would look like a broken search.
    const ratingBar = typeof minRating === "number" && minRating > 0 ? minRating : null;
    const reviewBar = typeof minReviews === "number" && minReviews > 0 ? minReviews : null;

    if (ratingBar !== null || reviewBar !== null) {
      const before = matching.length;
      let unknown = 0;
      matching = matching.filter((l) => {
        if (ratingBar !== null) {
          if (l.rating === null) { unknown++; return false; }
          if (l.rating < ratingBar) return false;
        }
        if (reviewBar !== null) {
          if (l.reviewCount === null) { unknown++; return false; }
          if (l.reviewCount < reviewBar) return false;
        }
        return true;
      });
      const cut = before - matching.length;
      if (cut > 0) {
        notes.push(
          `${cut} lead${cut === 1 ? "" : "s"} did not meet your rating or review bar` +
            (unknown > 0 ? `, including ${unknown} we hold no Google rating for` : "") +
            "."
        );
      }
    }

    if (webPresence !== "any") {
      const before = matching.length;
      matching = matching.filter((l) => {
        if (webPresence === "none") return !l.hasWebsite && !l.socialOnly;
        if (webPresence === "social_only") return l.socialOnly;
        return l.hasWebsite;   // has_site
      });
      const cut = before - matching.length;
      if (cut > 0) {
        // Phrased as what was kept, not as what they "did not" match: negating a
        // filter that is itself a negative produced "did not have no web presence".
        const label =
          webPresence === "none" ? "businesses with no web presence at all"
          : webPresence === "social_only" ? "businesses with only a social page"
          : "businesses with a site of their own";
        notes.push(
          `${cut} lead${cut === 1 ? "" : "s"} were left out, you asked for ${label}.`
        );
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
        gradePct(b.score, b.scoreMax) - gradePct(a.score, a.scoreMax) ||
        // Ties broken deterministically, because page two is a SEPARATE request that
        // re-ranks from scratch. Two leads with identical grades could otherwise swap
        // places between calls and be shown twice, or not at all.
        a.id.localeCompare(b.id)
    );
    const top = matching.slice(from, from + cap);

    const genuine = top.filter((l) => l.deliverable).length;
    // "Contact found", not "verified": only the free checks have run at this point. The
    // carrier and mailbox lookups fire when a lead is opened, and the promise attached
    // to that is the one worth stating, nobody pays for a lead that fails it.
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
    // Owner detail is priced separately, so it needs its own set of paid keys.
    const ownerKeys = user ? await getOwnerUnlockedKeys(user.id) : new Set<string>();
    // Without Stripe configured there is nothing to sell, so a demo deployment
    // shows everything rather than locking the operator out of their own instance.
    const everythingOpen = !stripeConfigured();

    // WATCHLIST: which of these has this market never shown before?
    //
    // Read before anything is marked seen, because the instant a business is recorded
    // it stops being new. This is the whole point of a watchlist: the second visit has
    // to be able to say "these four are new" or there is no reason to come back.
    let seen = new Set<string>();
    if (user && watchlistId) seen = await seenKeys(watchlistId);
    const isNewKey = (key: string) => Boolean(watchlistId) && !seen.has(key);

    const resultLeads: ResultLead[] = top.map((l) => ({
      ...viewLead(l, {
        dbId: rowIdByLeadId.get(l.id) ?? null,
        // A Lead's id IS its cross-search business key ("<source>:<source_id>").
        leadKey: l.id,
        unlockedKeys: unlocked,
        ownerKeys,
        everythingOpen,
      }),
      isNew: isNewKey(l.id),
    }));

    // WHAT A TRIAL ACCOUNT SEES.
    //
    // Cut here rather than hidden in the interface. Blurring in CSS leaves the whole
    // result set in the browser's network tab, which is not a limit, it is a costume.
    //
    // Subscribers are untouched. The trial keeps enough to prove the leads are real,
    // which is what it is for.
    const canPage = !access || access.subscribed;
    let hiddenByPlan = 0;
    let visibleLeads = resultLeads;
    if (access && !access.subscribed && resultLeads.length > FREE_PREVIEW_LEADS) {
      hiddenByPlan = resultLeads.length - FREE_PREVIEW_LEADS;
      visibleLeads = resultLeads.slice(0, FREE_PREVIEW_LEADS);
    }

    mark("scoring");
    const newCount = visibleLeads.filter((l) => l.isNew).length;
    if (user && watchlistId) {
      // Awaited, not fired and forgotten: work left running after the response is
      // returned gets killed on serverless, and a run that failed to record itself
      // would announce the same businesses as new all over again next week.
      await markSeen(user.id, watchlistId, top.map((l) => l.id), newCount);
    }

    const result: SearchResult = {
      niche,
      location,
      resolvedArea: area.displayName,
      matchedTags,
      count: visibleLeads.length,
      leads: visibleLeads,
      // How many were found but not shown, so the interface can say so honestly
      // rather than pretending the search returned three businesses.
      hiddenByPlan,
      totalFound: resultLeads.length,
      offset: from,
      // What is left BELOW this page, which is the only honest basis for offering more.
      // Nothing here is offered to a trial account: they are capped at the preview and
      // a Load more that returned the same three leads would be a worse answer than no
      // button at all.
      remaining: canPage ? Math.max(0, matching.length - (from + top.length)) : 0,
      notes,
      scannedAt,
      credits: access?.credits ?? 0,
      searchId,
      watchlistId: watchlistId ?? null,
      newCount,
      timings,
    };

    // FLUSH THE CACHE WRITES BEFORE RESPONDING.
    //
    // They were fired and forgotten, which is wrong on serverless: the function is
    // frozen the moment the body is returned, so a write still in flight simply never
    // lands. Measured after shipping it that way: six searches produced one cache
    // entry and zero cached audits.
    //
    // Awaited with a ceiling, because a slow write must delay the response by a little
    // rather than risk the whole request. Failures are swallowed by the writers
    // themselves, so a cache problem costs the next search's speed and nothing else.
    mark("persisted");
    if (cacheWrites.length > 0) {
      await Promise.race([
        Promise.allSettled(cacheWrites),
        new Promise((r) => setTimeout(r, 3_000)),
      ]);
    }

    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: `Lead search failed: ${msg}` }, { status: 500 });
  }
}
