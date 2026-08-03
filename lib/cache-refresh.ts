import { createAdminClient } from "./supabase/admin";
import { auditWebsite } from "./audit";
import { writeAudits, writeDiscovery } from "./search-cache";
import { pickSources } from "./sources";
import { geocode } from "./geocode";
import { resolveNiche } from "./niche";
import { mapPool } from "./pool";

// Keeping the cache warm.
//
// Stale-while-revalidate already refreshes whatever somebody happens to search, but
// that only helps the questions being asked today. This runs on a schedule and
// refreshes the entries people ask for MOST, so the popular searches are fast for the
// first person of the day rather than the second.
//
// Deliberately budgeted and capped. This shares a serverless invocation with the
// weekly digest, and a refresher that overruns takes the digest down with it.

const BUDGET_MS = 25_000;
const MAX_SEARCHES = 8;
const MAX_AUDITS = 60;

export type RefreshSummary = {
  searchesRefreshed: number;
  auditsRefreshed: number;
  purged: number;
  ranOutOfTime: boolean;
};

export async function refreshCache(): Promise<RefreshSummary> {
  const deadline = Date.now() + BUDGET_MS;
  const summary: RefreshSummary = {
    searchesRefreshed: 0,
    auditsRefreshed: 0,
    purged: 0,
    ranOutOfTime: false,
  };
  const admin = createAdminClient();

  // 1. Discovery. Most asked for, oldest first, so the popular questions stay fresh
  //    and something nobody has searched since March does not consume the budget.
  try {
    const { data: entries } = await admin
      .from("search_cache")
      .select("niche, area, hit_count")
      .order("hit_count", { ascending: false })
      .order("refreshed_at", { ascending: true })
      .limit(MAX_SEARCHES);

    const osm = pickSources().find((s) => s.name === "osm");
    for (const entry of entries ?? []) {
      if (Date.now() > deadline) { summary.ranOutOfTime = true; break; }
      if (!osm) break;
      try {
        // Rebuilt the same way a live search builds it, so a refreshed entry holds
        // exactly what a real search would have written.
        const area = await geocode(entry.area as string);
        if (!area) continue;
        const resolved = resolveNiche(entry.niche as string);
        const leads = await osm.search({
          filters: resolved.filters,
          nicheLabel: resolved.label,
          area,
          limit: 60,
        });
        if (leads.length > 0) {
          await writeDiscovery(entry.niche as string, entry.area as string, leads);
          summary.searchesRefreshed++;
        }
      } catch {
        // One bad area must not stop the rest. It keeps its stale entry, which is
        // still served, so the failure costs freshness rather than availability.
      }
    }
  } catch (e) {
    console.error("[cache-refresh] discovery pass failed:", e instanceof Error ? e.message : e);
  }

  // 2. Audits. The expensive half, and the half that goes stale fastest: a website
  //    can go down today and the whole change detection story rests on noticing.
  try {
    const { data: stale } = await admin
      .from("audit_cache")
      .select("host")
      .lt("expires_at", new Date().toISOString())
      .order("hit_count", { ascending: false })
      .limit(MAX_AUDITS);

    const hosts = (stale ?? []).map((r) => r.host as string);
    const fresh: { host: string; audit: Awaited<ReturnType<typeof auditWebsite>> }[] = [];
    await mapPool(hosts, 8, async (host) => {
      if (Date.now() > deadline) { summary.ranOutOfTime = true; return; }
      const audit = await auditWebsite(`https://${host}`);
      if (audit) fresh.push({ host, audit });
    });

    const usable = fresh.filter((f): f is { host: string; audit: NonNullable<typeof f.audit> } => Boolean(f.audit));
    if (usable.length > 0) {
      await writeAudits(usable);
      summary.auditsRefreshed = usable.length;
    }
  } catch (e) {
    console.error("[cache-refresh] audit pass failed:", e instanceof Error ? e.message : e);
  }

  // 3. Remove what expired long enough ago that nobody will be served it.
  try {
    const { data } = await admin.rpc("purge_expired_cache");
    summary.purged = Number(data ?? 0);
  } catch (e) {
    console.error("[cache-refresh] purge failed:", e instanceof Error ? e.message : e);
  }

  return summary;
}
