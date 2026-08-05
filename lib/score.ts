import type { Lead, ScoreFactor } from "./types";
import { SLOW_SITE_MS, THIN_CONTENT_WORDS, HEAVY_SCRIPT_COUNT } from "./audit";
import { playbookFactors, type PlaybookId } from "./playbooks";

/**
 * Google reviews above which a local business is "busy". A footfall proxy, and the
 * only volume signal available without paid firmographic data.
 */
export const HIGH_VOLUME_REVIEWS = 50;

// Score a lead on GENUINE NEED (do they lack a solid web presence / could use work?)
// plus CONTACTABILITY (can you actually reach them?). Higher = hotter opportunity.
//
// Every point is attributable to exactly one factor in FACTOR_CATALOG below, so the UI
// can show a full "why this grade" breakdown instead of an opaque number.

export type GradeBand = {
  tier: Lead["tier"];
  min: number;
  max: number;
  label: string;
  meaning: string;
  action: string;
};

/**
 * The published grade scale. Thresholds here are the ONLY place tiers are defined,
 * and they are read as a PERCENTAGE of MAX_ATTAINABLE (see gradePct), so the bands
 * keep their meaning as factors are added to the catalog.
 */
export const GRADE_SCALE: GradeBand[] = [
  {
    tier: "HOT",
    min: 70,
    max: 100,
    label: "Hot",
    meaning: "A clear, urgent gap in their web presence, and you can reach them today.",
    action: "Call first. Open with the specific problem you found.",
  },
  {
    tier: "WARM",
    min: 40,
    max: 69,
    label: "Warm",
    meaning: "Real gaps worth fixing, or easy to reach but only partly qualified.",
    action: "Worth an email sequence. Warm them up before pitching.",
  },
  {
    tier: "COOL",
    min: 0,
    max: 39,
    label: "Cool",
    meaning: "Solid presence, or hard to reach, no obvious pain to sell against.",
    action: "Low priority. Approach with a growth/AI angle, not a rebuild.",
  },
];

/**
 * Tier for a score, compared against the bands as a share of what was attainable
 * for that lead (see attainableFor).
 */
export function tierFor(score: number, max: number = MAX_ATTAINABLE): Lead["tier"] {
  const pct = gradePct(score, max);
  return (GRADE_SCALE.find((b) => pct >= b.min) ?? GRADE_SCALE[GRADE_SCALE.length - 1]).tier;
}

/**
 * Sort order for tiers, best first. Ranking by percentage alone put evidence-free
 * leads at the very top: a business we knew nothing about had a ceiling of just
 * phone + email, so having both scored 100% and outranked a genuinely Hot lead at 86%.
 * Tier already encodes "is there real evidence" (see HOT_MIN_NEED_POINTS), so it has
 * to be the primary key.
 */
export const TIER_RANK: Record<Lead["tier"], number> = { HOT: 3, WARM: 2, COOL: 1 };

export function bandFor(tier: Lead["tier"]): GradeBand {
  return GRADE_SCALE.find((b) => b.tier === tier)!;
}

export type FactorSpec = {
  key: string;
  group: "need" | "reach";
  points: number;
  label: string;
  why: string;
  /** Factors in the same slot are mutually exclusive, only the first match fires. */
  slot: string;
};

/**
 * Everything that can move the grade. Rendered verbatim in the "How the grade works"
 * panel, and used to drive the filter checkboxes, one source of truth.
 */
export const FACTOR_CATALOG: FactorSpec[] = [
  {
    key: "no_website",
    group: "need",
    points: 55,
    slot: "presence",
    label: "No website at all",
    why: "Nothing to defend and nothing to rebuild around, the biggest, cleanest sale.",
  },
  // WHAT CHANGED SINCE WE LAST LOOKED.
  //
  // Collected since migration 008 and, until now, never scored. Every search wrote a
  // snapshot and computed a diff, the card showed it, and the grade ignored it, so a
  // business whose site went down last week ranked level with one that had always been
  // fine. The single thing no competitor can sell was worth nothing to the ranking.
  //
  // Deliberately separate from the state factors below. "Their site is down" is a
  // condition; "their site went down since we last looked" is a date, and the date is
  // what makes the call land. A lead can legitimately carry both.
  {
    key: "just_broke",
    group: "need",
    points: 30,
    slot: "change",
    label: "Something broke since we last looked",
    why: "The timing is the pitch. You are calling the week it happened, not months after.",
  },
  {
    key: "recently_changed",
    group: "need",
    points: 16,
    slot: "change",
    label: "Changed something since we last looked",
    why: "A business in motion is making decisions. Reach them while it is still on the desk.",
  },
  {
    key: "site_down",
    group: "need",
    points: 50,
    slot: "presence",
    label: "Website down / unreachable",
    why: "They are losing customers this minute. The most urgent call you can make.",
  },
  {
    key: "social_only",
    group: "need",
    points: 45,
    slot: "presence",
    label: "No real website, only a social or delivery page",
    why: "They are running the business off someone else's platform. A site of their own is an easy, obvious win.",
  },
  // REWEIGHTED after measuring 189 real leads. These three were worth 48 points
  // between them but fired on 0.5%, 0% and 2.6% of leads respectively. Because the
  // ceiling includes every check we COULD run, those unearned points were quietly
  // dragging down the grade of leads that did have real findings. They are kept,
  // because when they do fire they are excellent pitches, at weights that match how
  // often that actually happens.
  {
    key: "no_ssl",
    group: "need",
    points: 8,
    slot: "ssl",
    label: "No HTTPS (insecure)",
    why: "Browsers show visitors a 'Not secure' warning. Rare now, but damning when you find it.",
  },
  {
    key: "not_mobile",
    group: "need",
    points: 10,
    slot: "mobile",
    label: "Not mobile-friendly",
    why: "No viewport, or a layout pinned to desktop width. Most of their traffic is on a phone.",
  },
  {
    key: "outdated",
    group: "need",
    points: 10,
    slot: "outdated",
    label: "Outdated site (copyright 2+ years old)",
    why: "Signals nobody maintains it, low resistance to a rebuild pitch.",
  },
  // --- 2. NEW detectors, chosen because they actually fire on real sites and each
  // one is demonstrable to the prospect in seconds. All measured from the homepage
  // fetch the audit already performs, so they add no API cost.
  {
    key: "slow_site",
    group: "need",
    points: 18,
    slot: "speed",
    label: "Slow website",
    why: "Every extra second loses visitors and Google ranking. You can demo it on their own phone.",
  },
  {
    key: "thin_content",
    group: "need",
    points: 12,
    slot: "content",
    label: "Almost no content on the homepage",
    why: "Nothing for Google to rank and nothing to convince a visitor. A content sale writes itself.",
  },
  {
    key: "no_schema",
    group: "need",
    points: 8,
    slot: "schema",
    label: "No structured data for Google",
    why: "No rich results: no stars, hours or map details in search. Cheap fix, visible win.",
  },
  {
    key: "no_analytics",
    group: "need",
    points: 8,
    slot: "analytics",
    label: "No analytics or tracking installed",
    why: "They cannot see where customers come from, so they cannot tell what is working.",
  },
  // --- Reputation / Google Business Profile ---
  // These only fire when a source actually reported the numbers (Places). OSM
  // leaves them null and null must never be sold as "they have no reviews".
  {
    key: "no_reviews",
    group: "need",
    points: 16,
    slot: "reputation",
    label: "No Google reviews",
    why: "Invisible in the map pack. Reviews and reputation work is an easy first sale.",
  },
  {
    key: "low_rating",
    group: "need",
    points: 14,
    slot: "reputation",
    label: "Rated below 4 stars",
    why: "They are losing customers at the comparison stage and usually know it.",
  },
  {
    key: "few_reviews",
    group: "need",
    points: 9,
    slot: "reputation",
    label: "Under 10 Google reviews",
    why: "Too little social proof to compete locally, a quick, concrete win.",
  },
  // --- Signals for buyers who are NOT selling websites. A payments reseller's whole
  // question is "are they busy, and who takes their money today", and none of the
  // web-quality factors above answer it.
  {
    key: "uses_switchable_vendor",
    group: "need",
    points: 40,
    slot: "vendor",
    label: "Already on a vendor you could replace",
    why: "A live contract with a competitor: a concrete opening, a known price to beat, and a business that has already decided to buy this category.",
  },
  {
    key: "high_volume",
    group: "need",
    points: 22,
    slot: "volume",
    label: "Busy business",
    why: "Enough reviews to suggest real footfall, so the deal is worth the same effort as a quiet one but pays more.",
  },
  {
    key: "no_online_ordering",
    group: "need",
    points: 18,
    slot: "ordering",
    label: "No online ordering or payments",
    why: "Taking orders by phone and cash only. Everything you sell is an upgrade from here.",
  },
  {
    key: "no_booking",
    group: "need",
    points: 10,
    slot: "booking",
    label: "No online booking",
    why: "Every enquiry has to be a phone call. Booking is a clear, billable add-on.",
  },
  {
    key: "no_hours",
    group: "need",
    points: 6,
    slot: "hours",
    label: "No opening hours listed",
    why: "A neglected Google profile, the cheapest fix you can lead with.",
  },
  {
    key: "phone",
    group: "reach",
    points: 18,
    slot: "phone",
    label: "Phone number listed",
    why: "You can close on a call instead of waiting on email.",
  },
  {
    key: "email",
    group: "reach",
    points: 12,
    slot: "email",
    label: "Email published",
    why: "Unlocks automated outreach sequences.",
  },
];

export function factorSpec(key: string): FactorSpec {
  return FACTOR_CATALOG.find((f) => f.key === key)!;
}

const inSlot = (slot: string) => FACTOR_CATALOG.filter((f) => f.slot === slot);
const sum = (fs: FactorSpec[]) => fs.reduce((a, f) => a + f.points, 0);

/**
 * Highest score any real lead can reach, derived from the catalog so it stays
 * correct as factors are added.
 *
 * The two website paths are exclusive: either the site is absent/down (best: no
 * website, 55) or it's live but flawed (20 + 16 + 12 = 48). Everything else is
 * additive: the best factor from each remaining slot, plus both contactability
 * factors.
 */
export const MAX_ATTAINABLE =
  Math.max(
    Math.max(...inSlot("presence").map((f) => f.points)),
    sum([...inSlot("ssl"), ...inSlot("mobile"), ...inSlot("outdated")]),
  ) +
  // One factor can fire per slot, so each contributes its best-scoring factor.
  ["reputation", "booking", "hours", "speed", "content", "schema", "analytics",
   "vendor", "volume", "ordering"].reduce(
    (total, slot) => total + Math.max(0, ...inSlot(slot).map((f) => f.points)),
    0,
  ) +
  sum(FACTOR_CATALOG.filter((f) => f.group === "reach"));

/**
 * The ceiling that applied before per-lead ceilings existed: the best website
 * factor plus both contactability factors, with no reputation checks in the
 * catalog yet. Saved leads in search history have no scoreMax, and grading them
 * against today's larger ceiling would silently mark down every lead the customer
 * already bought, so history keeps the scale it was graded on.
 */
export const LEGACY_ATTAINABLE = 85;

const slotMax = (slot: string) => Math.max(0, ...inSlot(slot).map((f) => f.points));

/**
 * The most THIS lead could have scored, given only the checks we were actually able
 * to run on it.
 *
 * Grading against the global MAX_ATTAINABLE would be unfair and unstable: Google
 * review data only exists when the Places source is configured, so on a
 * free/OpenStreetMap-only search every reputation point is unreachable and every
 * lead would collapse toward Cool purely because of a missing API key. A signal we
 * could not measure is therefore excluded from the denominator as well as the
 * numerator, which also keeps grades comparable before and after new factors ship.
 */
/**
 * The need and reach halves of a lead's ceiling, kept apart because they answer
 * different questions: reach is almost always knowable, need often is not, and
 * conflating them let a lead with no findings at all look perfect.
 */
/**
 * Which change factor a lead's history earns, if any.
 *
 * Shared by the ceiling and the scoring on purpose. They were written separately and
 * immediately disagreed: the ceiling took the change slot's maximum, 30, while an
 * ordinary change fires the 16 point factor, so on a payments playbook a business that
 * merely switched vendor dropped from 74% to 68% for the crime of having been seen
 * before. A ceiling computed from a different rule than the score is not a ceiling.
 */
export function changeFactorKey(l: Lead, allowed: Set<string> | null): string | null {
  const changes = l.changes ?? [];
  if (changes.length === 0) return null;
  const broke = changes.some((c) => c.kind === "site_went_down" || c.kind === "lost_own_site");
  const can = (key: string) => !allowed || allowed.has(key);
  if (broke && can("just_broke")) return "just_broke";
  return can("recently_changed") ? "recently_changed" : null;
}

export function attainableParts(l: Lead, playbook?: PlaybookId | null): { need: number; reach: number } {
  // Only the active playbook's factors count. A payments reseller's ceiling must not
  // include "no HTTPS", or their leads would be marked down for a gap they cannot sell
  // against, which is exactly what made the grade meaningless to them.
  const allowed = playbook ? playbookFactors(playbook) : null;
  const slotMaxScoped = (slot: string) =>
    Math.max(0, ...inSlot(slot).filter((f) => !allowed || allowed.has(f.key)).map((f) => f.points));
  const specPoints = (key: string) => (!allowed || allowed.has(key) ? factorSpec(key).points : 0);

  let max = 0;

  // Website path, mirroring the exclusive branches in scoreLead.
  if (l.socialOnly) {
    max += specPoints("social_only");
  } else if (!l.hasWebsite && !l.websiteKnown) {
    // Nothing about their web presence was knowable, so none of it counts either way.
  } else if (!l.hasWebsite) {
    max += specPoints("no_website");
  } else if (!l.siteAudited) {
    // Site never fetched: nothing about it was knowable.
  } else if (l.siteReachable === false) {
    max += specPoints("site_down");
  } else {
    // Only count the content checks whose inputs actually came back.
    if (l.hasSSL !== null) max += slotMaxScoped("ssl");
    if (l.mobileFriendly !== null) max += slotMaxScoped("mobile");
    if (l.outdated !== null) max += slotMaxScoped("outdated");
  }

  // A change counts toward the ceiling ONLY when we saw one.
  //
  // Not having seen a business before is not evidence about that business, so it must
  // never lower its grade. Nothing here can distinguish "we have watched them and
  // nothing moved" from "we have never watched them", and guessing wrong in the
  // punishing direction would mark every business we met today as worse than one we
  // happen to have history on. So the change slot can only ever raise a lead.
  const changeKey = changeFactorKey(l, allowed);
  if (changeKey) max += specPoints(changeKey);

  if (l.reviewCount !== null) max += slotMaxScoped("reputation");
  if (l.hasBooking !== null) max += slotMaxScoped("booking");
  if (l.hasHours !== null) max += slotMaxScoped("hours");
  if (l.loadMs !== null || l.scriptCount !== null) max += slotMaxScoped("speed");
  if (l.wordCount !== null) max += slotMaxScoped("content");
  if (l.hasSchema !== null) max += slotMaxScoped("schema");
  if (l.hasAnalytics !== null) max += slotMaxScoped("analytics");
  if (l.vendors !== null) max += slotMaxScoped("vendor");
  if (l.reviewCount !== null) max += slotMaxScoped("volume");
  if (l.vendors !== null || l.hasBooking !== null) max += slotMaxScoped("ordering");

  // Phone and email presence is always knowable.
  const reach = sum(
    FACTOR_CATALOG.filter((f) => f.group === "reach" && (!allowed || allowed.has(f.key)))
  );
  return { need: max, reach };
}

export function attainableFor(l: Lead, playbook?: PlaybookId | null): number {
  const { need, reach } = attainableParts(l, playbook);
  // Never divide by zero: a lead we know nothing about beyond its existence.
  return need + reach || reach;
}

/**
 * The least NEED evidence a lead must show to be called Hot.
 *
 * Hot is published as "a clear, urgent gap in their web presence, and you can reach
 * them today", so it has to be earned by findings, not by contact details. Set to
 * roughly one major finding (no website 55, down 50, social-only 45) or two real minor
 * ones (no HTTPS 20 + not mobile 16, no reviews 16 + no booking 10).
 *
 * Without this floor, a lead whose web presence we could not check at all had a
 * ceiling of just phone + email, so simply having both scored 100% and came out Hot.
 * Measured on 189 real leads, that was most of the Hot list: businesses we knew
 * nothing bad about, presented as the most urgent calls of the day.
 */
export const HOT_MIN_NEED_POINTS = 25;

/**
 * The floor for THIS lead, which is the flat floor capped by what could be found.
 *
 * The flat 25 assumed every buyer is scored on web presence, where the smallest real
 * finding is worth more than that. One playbook is not: "anything to local businesses"
 * deliberately makes no judgement about anyone's website, and the only need factor it
 * can award is a busy business, worth 22. Twenty two is under twenty five, so on that
 * playbook NO LEAD COULD EVER BE HOT. It is the default, so every account that had not
 * chosen a playbook was using a grader whose top tier was unreachable by arithmetic.
 * Measured across 318 leads in eight trades: 0 hot, 295 warm, 23 cool.
 *
 * Capping by what was attainable keeps the original guarantee and drops the false one.
 * The guarantee is that Hot means evidence: a lead nobody could check has an
 * attainable need of zero and is refused whatever else it scores. What it stops
 * claiming is that every buyer measures need on the same scale. Where only a little
 * could be checked, ALL of that little has to be bad, which is a stricter test than
 * the flat floor applies anywhere else.
 */
export function hotNeedFloor(attainableNeed: number): number {
  return Math.min(HOT_MIN_NEED_POINTS, attainableNeed);
}

/**
 * A lead's grade as a percentage of what was attainable for it. The tier bands are
 * defined on this, not on raw points, so adding a factor to the catalog neither
 * promotes nor demotes existing leads.
 */
export function gradePct(score: number, max: number): number {
  return Math.round((score / max) * 100);
}

export function scoreLead(l: Lead, playbook?: PlaybookId | null): {
  score: number;
  /** The most this lead could have scored given the checks we could run on it. */
  scoreMax: number;
  tier: Lead["tier"];
  signals: string[];
  factors: ScoreFactor[];
  pitch: string;
} {
  const factors: ScoreFactor[] = [];
  const signals: string[] = [];

  // A factor outside the active playbook is not scored AND not shown: the lead card
  // should be about the user's sale, not a survey of everything we happen to know.
  const allowed = playbook ? playbookFactors(playbook) : null;
  // Returns whether it actually fired. Several callers replace the generic catalog
  // label with a concrete one ("Already on Toast", "Slow website (3.4s)"), and doing
  // that blindly after a SKIPPED fire would overwrite the previous signal's label
  // with something about a factor this playbook never scored.
  const fire = (key: string): boolean => {
    if (allowed && !allowed.has(key)) return false;
    const spec = factorSpec(key);
    factors.push({ key: spec.key, label: spec.label, points: spec.points, group: spec.group });
    signals.push(spec.label);
    return true;
  };
  /** Fire, and if it fired, replace the label with a more specific one. */
  const fireWith = (key: string, label: string): boolean => {
    if (!fire(key)) return false;
    signals[signals.length - 1] = label;
    return true;
  };

  // Commentary about their website ("solid site", "we could not check it") is pushed
  // straight onto signals rather than through fire(), so it needs its own guard: a
  // payments reseller must not be told a restaurant's site is fine, because they were
  // never selling against the site. Only mention it if this buyer scores on it at all.
  const WEBSITE_FACTORS = [
    "no_website", "social_only", "site_down", "no_ssl", "not_mobile", "outdated",
    "slow_site", "thin_content", "no_schema", "no_analytics",
  ];
  const scoresWebsite = !allowed || WEBSITE_FACTORS.some((k) => allowed.has(k));
  const noteAboutSite = (text: string) => {
    if (scoresWebsite) signals.push(text);
  };

  // --- Need signals (the reason they'd buy) ---
  if (l.socialOnly) {
    // Checked FIRST: a Facebook or DoorDash page means hasWebsite is false (it isn't
    // their site), so testing "no website" before this would swallow the case and this
    // factor could never fire.
    fire("social_only");
  } else if (!l.hasWebsite && !l.websiteKnown) {
    // We genuinely do not know. Saying "no website at all" here was inventing our
    // biggest need signal out of a gap in the data: measured against Google Places,
    // 75% of OpenStreetMap businesses with no website tag actually have a website.
    noteAboutSite("Website unknown, no source could confirm one either way");
  } else if (!l.hasWebsite) {
    fire("no_website");
  } else if (l.siteReachable === false) {
    fire("site_down");
  } else if (!l.siteAudited) {
    // Their site was never fetched, so we know nothing about it. Say exactly that
    // rather than letting the absence of findings read as "solid site".
    noteAboutSite("Site not checked, grade may rise once it is");
  } else {
    if (l.hasSSL === false) fire("no_ssl");
    if (l.mobileFriendly === false) fire("not_mobile");
    if (l.outdated) {
      // Replace the generic catalog label with the concrete year we actually found.
      fireWith("outdated", `Outdated site (©${l.copyrightYear})`);
    }
    if (l.hasSSL && l.mobileFriendly && !l.outdated) noteAboutSite("Solid site, lower urgency");
  }

  // --- What changed since last time, if we have been here before ---
  const changes = l.changes ?? [];
  if (changes.length > 0) {
    // Something they had and lost outranks anything else they did: it is the only kind
    // that is costing them money while the phone rings.
    // Same rule the ceiling used, so the two cannot disagree about what this lead earns.
    const key = changeFactorKey(l, allowed);
    if (key) {
      const broke = changes.find((c) => c.kind === "site_went_down" || c.kind === "lost_own_site");
      fireWith(key, (broke ?? changes[0]).label);
    }
  }

  // --- Reputation, only when a source actually gave us the numbers ---
  // One factor per slot: the reputation slot is ordered strongest-pitch first, so
  // a business with 3 reviews at 2 stars is sold on the rating, not the count.
  if (l.reviewCount === 0) {
    fire("no_reviews");
  } else if (l.rating !== null && l.reviewCount !== null && l.reviewCount >= 5 && l.rating < 4) {
    fireWith("low_rating", `Rated ${l.rating.toFixed(1)} from ${l.reviewCount} reviews`);
  } else if (l.reviewCount !== null && l.reviewCount < 10) {
    fireWith("few_reviews", `Only ${l.reviewCount} Google review${l.reviewCount === 1 ? "" : "s"}`);
  }

  // Booking is only knowable from a site we successfully read.
  if (l.hasBooking === false) fire("no_booking");

  // Performance and SEO, all from the page we already fetched.
  // Slow by either measure: a genuinely slow response, or a page so script-heavy it
  // cannot be fast on a phone regardless of how quickly it answered us.
  const respondedSlowly = l.loadMs !== null && l.loadMs > SLOW_SITE_MS;
  const tooManyScripts = l.scriptCount !== null && l.scriptCount >= HEAVY_SCRIPT_COUNT;
  if (respondedSlowly || tooManyScripts) {
    // Always name the number: "slow" is arguable on a call, "3.4s" is not.
    fireWith(
      "slow_site",
      respondedSlowly
        ? `Slow website (${((l.loadMs as number) / 1000).toFixed(1)}s to load)`
        : `Heavy website (${l.scriptCount} scripts to load)`
    );
  }
  if (l.wordCount !== null && l.wordCount < THIN_CONTENT_WORDS) {
    fireWith("thin_content", `Almost no content on the homepage (~${l.wordCount} words)`);
  }
  if (l.hasSchema === false) fire("no_schema");
  if (l.hasAnalytics === false) fire("no_analytics");

  // --- Vendor / volume / ordering: what a reseller actually buys ---
  const switchable = (l.vendors ?? []).filter((v) => v.switchable);
  if (switchable.length > 0) {
    // Name them. "Already on a vendor" is useless on a call; "already on Toast" is the call.
    fireWith("uses_switchable_vendor", `Already on ${switchable.map((v) => v.name).join(", ")}`);
  }

  if (l.reviewCount !== null && l.reviewCount >= HIGH_VOLUME_REVIEWS) {
    fireWith("high_volume", `Busy business (${l.reviewCount} Google reviews)`);
  }

  // No way to order or pay online: greenfield for payments, ordering and software.
  const hasOrderingVendor = (l.vendors ?? []).some(
    (v) => v.category === "ordering" || v.category === "payments" || v.category === "pos"
  );
  if (l.siteAudited && !hasOrderingVendor && l.hasBooking === false) fire("no_online_ordering");

  if (l.hasHours === false) fire("no_hours");

  // --- Contactability (can you actually close them?) ---
  if (l.phone) fire("phone");
  else signals.push("No phone listed");

  if (l.email) fire("email");

  // Raw points, not clamped to 100: the grade is expressed as a share of scoreMax,
  // so clamping here would flatten the top of the range.
  const score = Math.max(0, factors.reduce((sum, f) => sum + f.points, 0));
  const parts = attainableParts(l, playbook);
  const scoreMax = parts.need + parts.reach || parts.reach;

  const needPoints = factors
    .filter((f) => f.group === "need")
    .reduce((total, f) => total + f.points, 0);

  // Hot has to be earned by evidence of a problem. Reach alone, however complete, is
  // not an opportunity: it only means we can phone someone who may need nothing.
  let tier = tierFor(score, scoreMax);
  // needPoints > 0 is not redundant with the floor: when nothing about a lead could be
  // checked the floor is zero, and zero evidence must never clear it.
  if (tier === "HOT" && (needPoints <= 0 || needPoints < hotNeedFloor(parts.need))) {
    // Some real finding, just not a big one -> Warm. Nothing found at all, or nothing
    // checkable -> Warm too, because "reachable but unqualified" is what Warm means.
    tier = needPoints > 0 || parts.need === 0 ? "WARM" : "COOL";
  }

  return {
    score,
    scoreMax,
    tier,
    signals,
    factors,
    pitch: buildPitch(l, signals),
  };
}

function buildPitch(l: Lead, signals: string[]): string {
  if (l.socialOnly)
    return `${l.name} runs on a social or delivery page instead of their own site, pitch a site they actually own, with booking and search traffic they keep.`;
  if (!l.hasWebsite && !l.websiteKnown)
    return `We could not confirm whether ${l.name} has a website, check before you call so you open with something accurate.`;
  if (!l.hasWebsite)
    return `${l.name} has no website, lead with a fast, modern site + Google presence to capture the customers they're losing.`;
  if (l.siteReachable === false)
    return `${l.name}'s website is down, urgent rebuild opportunity; they're actively losing business right now.`;
  if (!l.siteAudited)
    return `${l.name} has a website we haven't inspected yet, open it before you call so you lead with a specific gap.`;
  const problems: string[] = [];
  if (l.hasSSL === false) problems.push("no HTTPS");
  if (l.mobileFriendly === false) problems.push("not mobile-friendly");
  if (l.outdated) problems.push(`last updated ${l.copyrightYear}`);
  if (problems.length)
    return `${l.name}'s site is ${problems.join(", ")}, pitch a redesign that ranks and converts better.`;
  return `${l.name} has a decent site, approach with a growth/AI angle (automation, chatbot, SEO) rather than a rebuild.`;
}
