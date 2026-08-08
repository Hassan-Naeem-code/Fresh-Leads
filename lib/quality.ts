import { createAdminClient } from "./supabase/admin";
import { verifyContact } from "./verify/contact";
import { VERIFICATION_REASONS, REPORT_REASONS, type ReportReason } from "./report-reasons";
import type { Lead } from "./types";

// HOW ACCURATE ARE WE, ACTUALLY?
//
// Every claim on the marketing site was an adjective. "Verified." "Confirmed active."
// Nothing measured any of them, so if a prospect had asked "what's your bounce rate"
// the honest answer would have been that we did not know.
//
// That is the gap this closes, and it is worth more than any feature: the buyers worth
// having have been burned by a list before, and the only thing that separates us from
// the list that burned them is a number with a denominator next to it.
//
// TWO MEASUREMENTS, DELIBERATELY KEPT APART:
//
//   sampled   We re-check a random sample of leads customers actually PAID for, and
//             record what we find. Nobody has to choose to tell us, so it is unbiased,
//             and it is the number fit to publish.
//
//   reported  What customers told us was wrong. Biased low (most people never report)
//             and biased toward bad experiences when they do. Useful for finding what
//             to FIX; dishonest as a headline.
//
// Publishing the first and using the second internally is the whole design. Averaging
// them together would produce a number that means nothing and could not be defended.

/** How many leads to re-check per run. */
const SAMPLE_SIZE = 40;

/**
 * How far back to draw the sample.
 *
 * Leads sold in the last 30 days. Older than that and a dead number tells us about the
 * business closing rather than about our accuracy, which is a different question and
 * would make our own numbers look worse than they are for a reason that is not our
 * fault. `age_days` is recorded anyway so that assumption can be checked later.
 */
const SAMPLE_WINDOW_DAYS = 30;

/** Wall-clock ceiling: this rides along inside the daily cron and must not own it. */
const SAMPLE_BUDGET_MS = 25_000;

export type QualityWindow = {
  /** How many days the numbers cover. */
  days: number;
  // --- Measured, by us, on a random sample of leads that were actually sold.
  sampled: number;
  sampleHeld: number;
  /** Share of sampled leads that still passed the same test that let us sell them. */
  sampleAccuracy: number | null;
  phoneChecked: number;
  phoneOk: number;
  emailChecked: number;
  emailOk: number;
  // --- Reported, by customers.
  unlocked: number;
  reports: number;
  verificationReports: number;
  /** Reports as a share of leads sold in the window. */
  reportRate: number | null;
  byReason: { id: ReportReason; label: string; count: number }[];
  /** Refunds actually paid out, in credits. */
  creditsRefunded: number;
};

/**
 * Is there enough here to publish?
 *
 * A percentage computed from nine leads is noise wearing a number's clothes, and
 * publishing it would be exactly the kind of unbacked claim this whole module exists
 * to replace. Below the floor the public page says how much data we have and declines
 * to state a rate, which is a better look than a suspiciously round 100%.
 */
export const PUBLISHABLE_MIN_SAMPLE = 50;

export const isPublishable = (q: QualityWindow): boolean =>
  q.sampled >= PUBLISHABLE_MIN_SAMPLE && q.sampleAccuracy !== null;

/**
 * Re-check a random sample of recently sold leads.
 *
 * Runs the SAME paid verification the unlock ran, so the comparison is like for like:
 * the question is not "is this business contactable by any means" but "would the check
 * that let us sell this lead still pass today".
 *
 * Never throws. It rides inside the daily cron alongside the digest and housekeeping,
 * and a measurement failure must not take a customer-facing job down with it.
 */
export async function runQualitySample(): Promise<{ sampled: number; held: number; skipped: string }> {
  const deadline = Date.now() + SAMPLE_BUDGET_MS;
  try {
    const admin = createAdminClient();
    const since = new Date(Date.now() - SAMPLE_WINDOW_DAYS * 86_400_000).toISOString();

    // Leads that were actually bought, recently. lead_id can be null on older rows, so
    // the join is done in two steps rather than trusting it.
    const { data: unlocks, error } = await admin
      .from("lead_unlocks")
      .select("lead_key, lead_id, unlocked_at")
      .gte("unlocked_at", since)
      .not("lead_id", "is", null)
      .limit(600);

    if (error) {
      console.error("[quality] could not read unlocks:", error.message);
      return { sampled: 0, held: 0, skipped: "unlocks unreadable" };
    }
    if (!unlocks?.length) return { sampled: 0, held: 0, skipped: "nothing sold in the window" };

    // RANDOM, not the most recent. Taking the newest N would sample the leads least
    // likely to have gone stale and quietly flatter every number below it.
    //
    // One business at most, however many customers bought it: a popular lead would
    // otherwise dominate the sample and we would be measuring it rather than the
    // catalogue.
    const seen = new Set<string>();
    const pool = unlocks.filter((u) => {
      const k = u.lead_key as string;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const chosen = pool.slice(0, SAMPLE_SIZE);

    let sampled = 0;
    let held = 0;
    for (const u of chosen) {
      if (Date.now() > deadline) break;

      const { data: row } = await admin
        .from("leads")
        .select("raw")
        .eq("id", u.lead_id as string)
        .maybeSingle();
      const stored = row?.raw as unknown as Lead | null;
      if (!stored) continue;

      // A COPY. verifyContact mutates, and writing the re-check back onto the lead the
      // customer bought would silently rewrite the record they paid for.
      const probe: Lead = { ...stored, contactVerifiedAt: null };
      const claimedDeliverable = stored.deliverable === true;

      try {
        await verifyContact(probe, "paid");
      } catch {
        // A vendor outage is not a bad lead. Skip it rather than recording a failure
        // that says more about Twilio's afternoon than about our data.
        continue;
      }

      const phoneOk = stored.phone ? probe.phoneValid === true : null;
      const emailOk = stored.email
        ? probe.emailStatus === "deliverable" || probe.emailStatus === "risky"
        : null;
      const stillGood = probe.deliverable === true;

      const ageDays = Math.max(
        0,
        Math.round((Date.now() - new Date(u.unlocked_at as string).getTime()) / 86_400_000)
      );

      const { error: writeErr } = await admin.from("quality_samples").insert({
        lead_key: u.lead_key,
        age_days: ageDays,
        claimed_deliverable: claimedDeliverable,
        phone_ok: phoneOk,
        email_ok: emailOk,
        site_ok: stored.siteReachable,
        still_good: stillGood,
      });
      // A duplicate means this business was already sampled today. Not an error.
      if (writeErr && !/duplicate|unique/i.test(writeErr.message)) {
        console.error("[quality] sample write failed:", writeErr.message);
      }

      sampled++;
      if (stillGood) held++;
    }

    console.log(`[quality] sampled ${sampled}, ${held} still good`);
    return { sampled, held, skipped: "" };
  } catch (e) {
    console.error("[quality] sampling failed:", e instanceof Error ? e.message : e);
    return { sampled: 0, held: 0, skipped: "error" };
  }
}

export type ReliabilityWindow = {
  days: number;
  searches: number;
  /** Median and p95 wall clock, ms. Null when nothing was recorded. */
  medianMs: number | null;
  p95Ms: number | null;
  /** Searches that returned nothing at all. The most damaging outcome we have. */
  zero: number;
  zeroRate: number | null;
  /** Returned results but had to skip website audits to finish in time. */
  degraded: number;
  degradedRate: number | null;
  /** Ran past the budget the route sets for itself. */
  overBudget: number;
  /** The niche/location pairs that most often came back empty. */
  worstQueries: { query: string; zero: number }[];
};

/**
 * The route's own budget, mirrored so a search that ran past it can be counted.
 * Kept in sync by hand with REQUEST_BUDGET_MS in app/api/leads/route.ts; a search
 * exceeding it is a search that degraded something to finish.
 */
const REQUEST_BUDGET_MS = 30_000;

/**
 * How reliable does the search actually feel?
 *
 * p95 rather than the mean, because a search that usually takes nine seconds and
 * occasionally takes forty-five is experienced as a forty-five second product: the
 * slow one is what people remember, screenshot and tell their colleagues about.
 *
 * Reads the columns migration 033 added to `searches`, which are written on the
 * response path for every search including the ones that found nothing. That last part
 * is the whole point: empty searches used to leave no row anywhere, so the failure we
 * most needed to see was the one we could not count.
 */
export async function reliabilityReport(days = 7): Promise<ReliabilityWindow> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const empty: ReliabilityWindow = {
    days, searches: 0, medianMs: null, p95Ms: null,
    zero: 0, zeroRate: null, degraded: 0, degradedRate: null,
    overBudget: 0, worstQueries: [],
  };

  try {
    const { data, error } = await admin
      .from("searches")
      .select("niche, location, duration_ms, returned, audits_skipped")
      .gte("scanned_at", since)
      .limit(5000);
    // Same trap as qualityReport: an error here arrives in the result rather than as a
    // throw, so without this an unrun migration 033 is silently reported as "no
    // searches" on a platform that is serving them all day.
    if (error) {
      console.error("[quality] searches unreadable:", error.message);
      return empty;
    }
    if (!data?.length) return empty;

    // Rows written before migration 033 have no duration. Excluded from the timing
    // percentiles rather than counted as zero, which would drag both downward and make
    // the product look faster than it is.
    const timed = data
      .map((r) => r.duration_ms as number | null)
      .filter((n): n is number => typeof n === "number")
      .sort((a, b) => a - b);

    const at = (p: number) =>
      timed.length === 0 ? null : timed[Math.min(timed.length - 1, Math.floor(timed.length * p))];

    const zeroRows = data.filter((r) => (r.returned ?? 0) === 0);
    const degraded = data.filter((r) => (r.audits_skipped ?? 0) > 0).length;

    // Which queries come back empty most often. This is the actionable half: a niche
    // that reliably finds nothing is either missing from the catalogue in lib/niche.ts
    // or is being asked for in places that genuinely have none, and the two are
    // distinguishable only by looking at the list.
    const zeroBy = new Map<string, number>();
    for (const r of zeroRows) {
      const key = `${r.niche} · ${r.location}`;
      zeroBy.set(key, (zeroBy.get(key) ?? 0) + 1);
    }

    return {
      days,
      searches: data.length,
      medianMs: at(0.5),
      p95Ms: at(0.95),
      zero: zeroRows.length,
      zeroRate: Math.round((zeroRows.length / data.length) * 1000) / 10,
      degraded,
      degradedRate: Math.round((degraded / data.length) * 1000) / 10,
      overBudget: timed.filter((n) => n > REQUEST_BUDGET_MS).length,
      worstQueries: [...zeroBy.entries()]
        .map(([query, zero]) => ({ query, zero }))
        .sort((a, b) => b.zero - a.zero)
        .slice(0, 8),
    };
  } catch (e) {
    console.error("[quality] reliability failed:", e instanceof Error ? e.message : e);
    return empty;
  }
}

/**
 * The numbers, over a window.
 *
 * Every rate here returns null rather than zero when its denominator is empty. A
 * product with no sales yet has no accuracy rate, and rendering that as "0%" would be
 * both wrong and the worst possible first impression.
 */
export async function qualityReport(days = 30): Promise<QualityWindow> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const empty: QualityWindow = {
    days,
    sampled: 0, sampleHeld: 0, sampleAccuracy: null,
    phoneChecked: 0, phoneOk: 0, emailChecked: 0, emailOk: 0,
    unlocked: 0, reports: 0, verificationReports: 0, reportRate: null,
    byReason: [], creditsRefunded: 0,
  };

  try {
    const [samples, unlocks, reports] = await Promise.all([
      admin
        .from("quality_samples")
        .select("still_good, phone_ok, email_ok")
        .gte("checked_at", since),
      admin
        .from("lead_unlocks")
        .select("id", { count: "exact", head: true })
        .gte("unlocked_at", since),
      admin
        .from("lead_reports")
        .select("reason, refunded_credits")
        .gte("created_at", since),
    ]);

    // SUPABASE RETURNS ERRORS, IT DOES NOT THROW THEM, so the try/catch around this
    // block never sees a failed query. Read without this check, a missing table (the
    // state of any deployment where migrations 031/032 have not been run) produced a
    // clean page of zeros and logged absolutely nothing, which reads as "no data yet"
    // and is indistinguishable from it.
    //
    // The page still renders: an accuracy page that 500s is worse than one that says it
    // has nothing to show. But the operator gets told why.
    for (const [name, res] of [
      ["quality_samples", samples], ["lead_unlocks", unlocks], ["lead_reports", reports],
    ] as const) {
      if (res.error) {
        console.error(`[quality] ${name} unreadable, reporting zero for it:`, res.error.message);
      }
    }

    const s = samples.data ?? [];
    const r = reports.data ?? [];

    const sampled = s.length;
    const sampleHeld = s.filter((x) => x.still_good).length;
    const phoneRows = s.filter((x) => x.phone_ok !== null);
    const emailRows = s.filter((x) => x.email_ok !== null);
    const unlocked = unlocks.count ?? 0;

    const counts = new Map<string, number>();
    for (const row of r) counts.set(row.reason as string, (counts.get(row.reason as string) ?? 0) + 1);

    const verificationReports = r.filter((x) =>
      VERIFICATION_REASONS.includes(x.reason as ReportReason)
    ).length;

    return {
      days,
      sampled,
      sampleHeld,
      sampleAccuracy: sampled > 0 ? Math.round((sampleHeld / sampled) * 1000) / 10 : null,
      phoneChecked: phoneRows.length,
      phoneOk: phoneRows.filter((x) => x.phone_ok).length,
      emailChecked: emailRows.length,
      emailOk: emailRows.filter((x) => x.email_ok).length,
      unlocked,
      reports: r.length,
      verificationReports,
      reportRate: unlocked > 0 ? Math.round((r.length / unlocked) * 1000) / 10 : null,
      byReason: REPORT_REASONS.map((def) => ({
        id: def.id,
        label: def.label,
        count: counts.get(def.id) ?? 0,
      })).filter((x) => x.count > 0),
      creditsRefunded: r.reduce((n, x) => n + ((x.refunded_credits as number) ?? 0), 0),
    };
  } catch (e) {
    console.error("[quality] report failed:", e instanceof Error ? e.message : e);
    return empty;
  }
}
