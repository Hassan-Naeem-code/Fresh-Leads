import { createAdminClient } from "./supabase/admin";
import type { RawLead } from "./sources";
import type { Audit } from "./audit";

// The cache in front of the two slow, shared stages of a search.
//
// Both are facts about the world rather than about a customer: which businesses are
// in an area, and what their websites look like. Two people searching "dentists in
// Austin" an hour apart should not both wait for the same crawl.
//
// STALE WHILE REVALIDATE is the shape throughout. An entry past its expiry is still
// served, and a refresh is kicked off for next time. The alternative, blocking on a
// refresh, means the unlucky customer whose search happens to land on the expiry
// minute waits the full uncached time, which is exactly the experience the cache
// exists to remove.

/** How long each kind of answer stays fresh. */
const DISCOVERY_TTL_HOURS = 24 * 7;
const AUDIT_TTL_HOURS = 24;

/**
 * What a search is, as a key.
 *
 * Normalised hard, because "Dentists" in "Austin, TX" and "dentists" in "austin tx"
 * are the same question and a cache that treats them as two is a cache that mostly
 * misses.
 */
export function cacheKey(niche: string, area: string): string {
  const clean = (v: string) =>
    v
      .toLowerCase()
      // Decompose, then DROP the combining marks. Without the second step "cafés"
      // decomposes to "cafe" plus an accent, the accent becomes a space, and the key
      // reads "cafe s": a permanent miss against everyone who typed "cafes".
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  return `${clean(niche)}|${clean(area)}`;
}

export type CachedDiscovery = {
  leads: RawLead[];
  ageHours: number;
  stale: boolean;
};

/**
 * Businesses we already know are in this area.
 *
 * OSM rows ONLY. Google Places content may not be stored beyond place_id and
 * coordinates, so a search still calls Places live and merges the two. That is a
 * deliberate cost, not an oversight.
 */
export async function readDiscovery(niche: string, area: string): Promise<CachedDiscovery | null> {
  const key = cacheKey(niche, area);
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("search_cache")
      .select("payload, refreshed_at, expires_at")
      .eq("cache_key", key)
      .maybeSingle();
    if (!data) return null;

    const leads = (data.payload as RawLead[]) ?? [];
    if (!Array.isArray(leads) || leads.length === 0) return null;

    // AWAITED, despite the cost of one fast round trip.
    //
    // It was fired and forgotten on the same reasoning as the writes were, and it
    // failed the same way: the function freezes when the response returns, so the
    // count stayed at zero through every hit. That number is the only thing telling
    // the refresher which searches people actually run, so an uncounted hit means the
    // popular entries are never the ones kept warm.
    await admin.rpc("touch_search_cache", { p_key: key });

    const ageMs = Date.now() - new Date(data.refreshed_at as string).getTime();
    return {
      leads,
      ageHours: Math.round(ageMs / 3_600_000),
      stale: new Date(data.expires_at as string).getTime() < Date.now(),
    };
  } catch (e) {
    // A cache that throws must never break a search. Falling through to a live
    // discovery is slower and correct.
    console.error("[cache] discovery read failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function writeDiscovery(niche: string, area: string, leads: RawLead[]): Promise<void> {
  // Only OSM. Filtering here rather than at the call site so no future caller can
  // forget and put Places content in the table.
  const storable = leads.filter((l) => l.source === "osm");
  if (storable.length === 0) return;

  try {
    const admin = createAdminClient();
    await admin.from("search_cache").upsert(
      {
        cache_key: cacheKey(niche, area),
        niche,
        area,
        payload: storable,
        lead_count: storable.length,
        refreshed_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + DISCOVERY_TTL_HOURS * 3_600_000).toISOString(),
      },
      { onConflict: "cache_key" }
    );
  } catch (e) {
    console.error("[cache] discovery write failed:", e instanceof Error ? e.message : e);
  }
}

export type CachedAudits = {
  byHost: Map<string, Audit>;
  /** Hosts whose entry is past its expiry, so the caller can refresh them in place. */
  staleHosts: string[];
  /**
   * When each cached audit was actually crawled.
   *
   * The lead card tells the customer when we last looked at a business, and serving a
   * cached audit is not looking. Without this the answer would be "just now" for work
   * done up to a day ago, which is precisely the claim the product exists to make
   * honestly.
   */
  crawledAt: Map<string, string>;
};

/** Website audits we already have, for the hosts in this batch. */
export async function readAudits(hosts: string[]): Promise<CachedAudits> {
  const byHost = new Map<string, Audit>();
  const staleHosts: string[] = [];
  const crawledAt = new Map<string, string>();
  const unique = [...new Set(hosts.filter(Boolean))];
  if (unique.length === 0) return { byHost, staleHosts, crawledAt };

  try {
    const admin = createAdminClient();
    const now = Date.now();
    // Chunked: the filter goes into the URL, and eighty hosts is already a long one.
    for (let i = 0; i < unique.length; i += 100) {
      const slice = unique.slice(i, i + 100);
      const { data } = await admin
        .from("audit_cache")
        .select("host, audit, expires_at, refreshed_at")
        .in("host", slice);
      for (const row of data ?? []) {
        byHost.set(row.host as string, row.audit as Audit);
        if (row.refreshed_at) crawledAt.set(row.host as string, row.refreshed_at as string);
        if (new Date(row.expires_at as string).getTime() < now) staleHosts.push(row.host as string);
      }
      await admin.rpc("touch_audit_cache", { p_hosts: slice });
    }
  } catch (e) {
    console.error("[cache] audit read failed:", e instanceof Error ? e.message : e);
  }
  return { byHost, staleHosts, crawledAt };
}

export async function writeAudits(entries: { host: string; audit: Audit }[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    const admin = createAdminClient();
    const expires = new Date(Date.now() + AUDIT_TTL_HOURS * 3_600_000).toISOString();
    await admin.from("audit_cache").upsert(
      entries.map((e) => ({
        host: e.host,
        audit: e.audit,
        reachable: e.audit.reachable,
        refreshed_at: new Date().toISOString(),
        expires_at: expires,
      })),
      { onConflict: "host" }
    );
  } catch (e) {
    console.error("[cache] audit write failed:", e instanceof Error ? e.message : e);
  }
}

/** The hostname an audit is filed under. Shared so read and write cannot disagree. */
export function hostKey(website: string): string | null {
  if (!website) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
    return url.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// HIRING, carried forward from whoever paid to discover it
//
// Learned by the enrichment crawl at unlock, because finding it means fetching a
// careers page and the search already runs 40 audits inside a 60 second function.
// Remembered here so the next search that meets the same business gets it for free,
// which is why coverage compounds with use rather than being rediscovered each time.
// ---------------------------------------------------------------------------

/** Shorter than the audit TTL: a role filled two months ago is not a reason to call. */
const HIRING_TTL_MS = 21 * 24 * 60 * 60 * 1000;

export type HiringFact = { hiring: boolean; hiringUrl: string | null };

/** What we already know about hiring at these hosts. Unknown hosts are simply absent. */
export async function readHiring(hosts: string[]): Promise<Map<string, HiringFact>> {
  const out = new Map<string, HiringFact>();
  const unique = [...new Set(hosts.filter(Boolean))];
  if (unique.length === 0) return out;

  try {
    const admin = createAdminClient();
    const now = Date.now();
    for (let i = 0; i < unique.length; i += 100) {
      const { data } = await admin
        .from("hiring_signals")
        .select("host, hiring, hiring_url, expires_at")
        .in("host", unique.slice(i, i + 100));
      for (const row of data ?? []) {
        // Expired rows are ignored rather than served. A stale hiring claim is worse
        // than none: it puts a rep on the phone congratulating someone on a vacancy
        // they filled in the spring.
        if (new Date(row.expires_at as string).getTime() < now) continue;
        out.set(row.host as string, {
          hiring: row.hiring as boolean,
          hiringUrl: (row.hiring_url as string | null) ?? null,
        });
      }
    }
  } catch (e) {
    // Same rule as every other cache read: a signal we cannot fetch costs a grade,
    // never the search.
    console.error("[cache] hiring read failed:", e instanceof Error ? e.message : e);
  }
  return out;
}

/** File what an unlock discovered, so nobody pays to learn it twice. */
export async function writeHiring(host: string, fact: HiringFact): Promise<void> {
  if (!host) return;
  try {
    await createAdminClient()
      .from("hiring_signals")
      .upsert(
        {
          host,
          hiring: fact.hiring,
          hiring_url: fact.hiringUrl,
          checked_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + HIRING_TTL_MS).toISOString(),
        },
        { onConflict: "host" }
      );
  } catch (e) {
    console.error("[cache] hiring write failed:", e instanceof Error ? e.message : e);
  }
}
