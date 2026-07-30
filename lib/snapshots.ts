import { createAdminClient } from "./supabase/admin";
import { classifyWebsite } from "./website-kind";
import type { Audit } from "./audit";
import type { Lead } from "./types";

// CHANGE OVER TIME: the part of a lead a competitor structurally cannot copy from a
// live query.
//
// Apollo and Openmart both sell out of a standing database, so they can tell you what
// a business IS. Neither tells a local seller what a business just STOPPED or STARTED
// doing, because their intent data is third-party and account-level and does not
// reach a pizza shop at all. A business that switched POS vendor last month, or whose
// site went down last week, is a call worth making this week. That is what a diff buys.
//
// The catch, stated plainly: nothing here produces a signal until a business has been
// crawled twice. This ships dark and only becomes sellable once snapshots accumulate,
// which is exactly why it is worth starting early. Yesterday's observation cannot be
// backfilled.

/** One stored observation of a business's own website. */
export type Snapshot = {
  leadKey: string;
  siteHost: string | null;
  capturedAt: string;
  reachable: boolean | null;
  websiteKind: string | null;
  hasSSL: boolean | null;
  mobileFriendly: boolean | null;
  hasBooking: boolean | null;
  hasSchema: boolean | null;
  hasAnalytics: boolean | null;
  loadMs: number | null;
  wordCount: number | null;
  scriptCount: number | null;
  copyrightYear: number | null;
  vendorIds: string[] | null;
};

/**
 * A detected change, in the form a rep can actually say out loud.
 *
 * `since` is the date of the observation we compared against, so the UI can say "since
 * 12 June" rather than implying we watched it happen.
 */
export type Trigger = {
  kind: TriggerKind;
  label: string;
  since: string;
};

export type TriggerKind =
  | "site_went_down"
  | "site_recovered"
  | "vendor_switched"
  | "vendor_adopted"
  | "vendor_dropped"
  | "booking_added"
  | "booking_removed"
  | "lost_own_site"
  | "gained_own_site";

/** The hostname we fetched, or null. Used to notice a business changing domain. */
export function hostOf(url: string): string | null {
  if (!url) return null;
  try {
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withScheme).hostname.replace(/^www\./i, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Build the row we store from an audit we just ran. */
export function snapshotFromAudit(leadKey: string, website: string, audit: Audit): Snapshot {
  return {
    leadKey,
    siteHost: hostOf(website),
    capturedAt: new Date().toISOString(),
    reachable: audit.reachable,
    websiteKind: website ? classifyWebsite(website) : null,
    hasSSL: audit.hasSSL,
    mobileFriendly: audit.mobileFriendly,
    hasBooking: audit.hasBooking,
    hasSchema: audit.hasSchema,
    hasAnalytics: audit.hasAnalytics,
    loadMs: audit.loadMs,
    wordCount: audit.wordCount,
    scriptCount: audit.scriptCount,
    copyrightYear: audit.copyrightYear,
    vendorIds: audit.vendors ? [...new Set(audit.vendors.map((v) => v.id))].sort() : null,
  };
}

/**
 * Compare two observations of the same business and report what changed.
 *
 * PURE, and deliberately conservative. A false "they just switched POS" is worse than
 * silence: it is the one claim a prospect can disprove in the first ten seconds of the
 * call, and it costs the customer the meeting. So every rule here requires BOTH sides
 * to be known. A null on either side means we did not observe it, never that it
 * changed, which is why `null -> false` produces nothing at all.
 *
 * `names` maps vendor ids to display names. It is passed in rather than imported so
 * this stays a pure function that tests can drive without touching the vendor catalog.
 */
export function diffSnapshots(
  prev: Snapshot,
  curr: Snapshot,
  names: (id: string) => string = (id) => id
): Trigger[] {
  const out: Trigger[] = [];
  const since = prev.capturedAt.slice(0, 10);
  const add = (kind: TriggerKind, label: string) => out.push({ kind, label, since });

  // A business that changed domain is not the same website, and comparing the old
  // site's readings against the new one's would invent changes that never happened.
  // Domain moves are worth surfacing on their own, but not as a stack of false diffs.
  if (prev.siteHost && curr.siteHost && prev.siteHost !== curr.siteHost) return out;

  const known = (a: unknown, b: unknown) => a !== null && a !== undefined && b !== null && b !== undefined;

  // --- reachability -------------------------------------------------------
  if (known(prev.reachable, curr.reachable)) {
    if (prev.reachable && !curr.reachable) {
      add("site_went_down", "Website has gone down since we last checked");
    } else if (!prev.reachable && curr.reachable) {
      add("site_recovered", "Website is back up after being down");
    }
  }

  // --- own site vs social page -------------------------------------------
  if (known(prev.websiteKind, curr.websiteKind) && prev.websiteKind !== curr.websiteKind) {
    const wasOwn = prev.websiteKind === "own_domain";
    const isOwn = curr.websiteKind === "own_domain";
    if (wasOwn && !isOwn) add("lost_own_site", "No longer has a site of their own");
    else if (!wasOwn && isOwn) add("gained_own_site", "Has just put up a site of their own");
  }

  // --- online booking -----------------------------------------------------
  if (known(prev.hasBooking, curr.hasBooking) && prev.hasBooking !== curr.hasBooking) {
    if (curr.hasBooking) add("booking_added", "Has just added online booking or ordering");
    else add("booking_removed", "Has dropped online booking or ordering");
  }

  // --- vendors ------------------------------------------------------------
  // Only meaningful when both crawls actually read the page. An unreadable page
  // detects no vendors, which would otherwise look exactly like dropping all of them.
  if (prev.vendorIds && curr.vendorIds && prev.reachable && curr.reachable) {
    const before = new Set(prev.vendorIds);
    const after = new Set(curr.vendorIds);
    const gained = [...after].filter((v) => !before.has(v));
    const lost = [...before].filter((v) => !after.has(v));

    if (gained.length && lost.length) {
      add(
        "vendor_switched",
        `Switched from ${lost.map(names).join(", ")} to ${gained.map(names).join(", ")}`
      );
    } else if (gained.length) {
      add("vendor_adopted", `Has just started using ${gained.map(names).join(", ")}`);
    } else if (lost.length) {
      add("vendor_dropped", `Has stopped using ${lost.map(names).join(", ")}`);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Storage. Service role only: this table has RLS on and no policies.
// ---------------------------------------------------------------------------

const toRow = (s: Snapshot) => ({
  lead_key: s.leadKey,
  site_host: s.siteHost,
  reachable: s.reachable,
  website_kind: s.websiteKind,
  has_ssl: s.hasSSL,
  mobile_friendly: s.mobileFriendly,
  has_booking: s.hasBooking,
  has_schema: s.hasSchema,
  has_analytics: s.hasAnalytics,
  load_ms: s.loadMs,
  word_count: s.wordCount,
  script_count: s.scriptCount,
  copyright_year: s.copyrightYear,
  vendor_ids: s.vendorIds,
});

/**
 * Record today's observations. At most one row per business per UTC day survives, so
 * a second search of the same city is a cheap no-op rather than a duplicate.
 *
 * Never throws. A search that found real leads must not fail because a background
 * observation could not be filed.
 */
export async function saveSnapshots(snaps: Snapshot[]): Promise<number> {
  if (snaps.length === 0) return 0;
  try {
    const admin = createAdminClient();
    const { error, count } = await admin
      .from("business_snapshots")
      .upsert(snaps.map(toRow), { onConflict: "lead_key,captured_on", ignoreDuplicates: true, count: "exact" });
    if (error) {
      console.error("[snapshots] save failed:", error.message);
      return 0;
    }
    return count ?? 0;
  } catch (e) {
    console.error("[snapshots] save threw:", e);
    return 0;
  }
}

const fromRow = (r: Record<string, unknown>): Snapshot => ({
  leadKey: r.lead_key as string,
  siteHost: (r.site_host as string) ?? null,
  capturedAt: r.captured_at as string,
  reachable: (r.reachable as boolean) ?? null,
  websiteKind: (r.website_kind as string) ?? null,
  hasSSL: (r.has_ssl as boolean) ?? null,
  mobileFriendly: (r.mobile_friendly as boolean) ?? null,
  hasBooking: (r.has_booking as boolean) ?? null,
  hasSchema: (r.has_schema as boolean) ?? null,
  hasAnalytics: (r.has_analytics as boolean) ?? null,
  loadMs: (r.load_ms as number) ?? null,
  wordCount: (r.word_count as number) ?? null,
  scriptCount: (r.script_count as number) ?? null,
  copyrightYear: (r.copyright_year as number) ?? null,
  vendorIds: (r.vendor_ids as string[]) ?? null,
});

/**
 * The most recent snapshot for each of these businesses taken BEFORE today.
 *
 * Today's rows are excluded on purpose: today's is the one we are about to write, and
 * comparing a business against itself an hour ago produces noise, not news.
 */
export async function previousSnapshots(leadKeys: string[]): Promise<Map<string, Snapshot>> {
  const out = new Map<string, Snapshot>();
  if (leadKeys.length === 0) return out;

  const today = new Date().toISOString().slice(0, 10);
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("business_snapshots")
      .select("*")
      .in("lead_key", leadKeys)
      .lt("captured_on", today)
      .order("captured_at", { ascending: false })
      .limit(5000);
    if (error) {
      console.error("[snapshots] read failed:", error.message);
      return out;
    }
    // Rows arrive newest first, so the first one seen per business is the latest.
    for (const row of data ?? []) {
      const s = fromRow(row as Record<string, unknown>);
      if (!out.has(s.leadKey)) out.set(s.leadKey, s);
    }
  } catch (e) {
    console.error("[snapshots] read threw:", e);
  }
  return out;
}

/**
 * Record this batch and report what changed since each business was last seen.
 *
 * Reads before it writes, because writing today's row first would make it the thing
 * we compare against.
 */
export async function observeAndDiff(
  leads: Lead[],
  auditByKey: Map<string, Audit>
): Promise<Map<string, Trigger[]>> {
  const snaps: Snapshot[] = [];
  for (const lead of leads) {
    const audit = auditByKey.get(lead.id);
    if (audit) snaps.push(snapshotFromAudit(lead.id, lead.website, audit));
  }
  if (snaps.length === 0) return new Map();

  const prior = await previousSnapshots(snaps.map((s) => s.leadKey));

  const { VENDORS } = await import("./vendors");
  const nameById = new Map(VENDORS.map((v) => [v.id, v.name]));
  const names = (id: string) => nameById.get(id) ?? id;

  const triggers = new Map<string, Trigger[]>();
  for (const snap of snaps) {
    const before = prior.get(snap.leadKey);
    if (!before) continue;
    const found = diffSnapshots(before, snap, names);
    if (found.length) triggers.set(snap.leadKey, found);
  }

  await saveSnapshots(snaps);
  return triggers;
}
