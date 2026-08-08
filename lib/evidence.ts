import type { Lead } from "./types";

// WHERE EVERY CLAIM ON A LEAD CAME FROM, AND WHEN.
//
// The product already refuses to assert what it has not established: null means "we did
// not check", the size estimate carries its own basis string, the freshness line says
// whether the date is theirs or ours. That discipline is real and it is unusual.
//
// What was missing is that none of it was ASSEMBLED. A rep looking at "no online
// booking" next to "verified phone" had no way to ask which of those we measured
// ourselves, which we took from a third party, and how long ago. So the honest signals
// and the inferred ones looked identical, and a customer deciding whether to trust the
// list had nothing to inspect.
//
// This turns "trust us" into "here is the receipt". Every row states:
//
//   claim     what we are asserting
//   how       how we know it, in the customer's language, not ours
//   when      when we last looked, or null where the question has no timestamp
//   check     a URL where they can verify it themselves, where one exists
//
// THE LINK IS THE POINT. Anyone can print a confidence score. Handing someone the
// Google listing and the page we read is the thing a vendor with something to hide
// cannot do, and it costs us nothing because we already hold both.

export type EvidenceRow = {
  claim: string;
  how: string;
  /** ISO timestamp, or null where the fact has no meaningful "when". */
  when: string | null;
  /** Somewhere the customer can confirm it for themselves. */
  check?: string;
  /**
   * Did WE establish this, or did somebody hand it to us?
   *
   * Shown because they are different levels of certainty and a rep about to open a call
   * with a claim deserves to know which one they are holding. "We fetched their site
   * and read it" survives being challenged on the phone; "a database says so" does not.
   */
  origin: "ours" | "theirs" | "third_party";
};

const SOURCE_LABEL: Record<string, string> = {
  osm: "OpenStreetMap",
  google_places: "Google Business Profile",
};

/**
 * Everything we assert about this business, with its provenance.
 *
 * Rows are omitted rather than rendered empty: a claim we never made needs no evidence,
 * and a row saying "we did not check this" for every unchecked field would bury the
 * ones that matter under noise. The absence of a row IS the honest signal, and the
 * modal says so once at the top rather than forty times.
 */
export function evidenceFor(lead: Lead): EvidenceRow[] {
  const rows: EvidenceRow[] = [];
  const listing = SOURCE_LABEL[lead.source] ?? lead.source;

  // --- Who and where. Always present: it is why the lead exists.
  rows.push({
    claim: `${lead.name} is a ${(lead.category || "business").replace(/_/g, " ")}${lead.city ? ` in ${lead.city}` : ""}`,
    how: `Listed on ${listing}`,
    when: lead.lastUpdated,
    check: lead.mapUrl || undefined,
    origin: "theirs",
  });

  // --- Are they trading?
  if (lead.businessStatus) {
    rows.push({
      claim:
        lead.businessStatus === "operational"
          ? "Currently trading"
          : lead.businessStatus === "closed_temporarily"
            ? "Temporarily closed"
            : "Permanently closed",
      how: `${listing} reports this status`,
      when: lead.lastUpdated,
      check: lead.mapUrl || undefined,
      origin: "theirs",
    });
  }

  // --- Contact channels. The two claims a rep actually stakes a call on.
  if (lead.phone) {
    // The distinction that matters most on this whole screen. The free tier only
    // proves a number is well FORMED; the paid tier proves the line exists. Presenting
    // those as the same thing is exactly the overclaim this module exists to prevent.
    const carrierChecked = Boolean(lead.contactVerifiedAt);
    rows.push({
      claim: `${lead.phone} is a working line`,
      how: carrierChecked
        ? `Confirmed live with the carrier${lead.phoneType ? `, a ${lead.phoneType} line` : ""}`
        : "Checked for a valid format only, not yet dialled",
      when: lead.contactVerifiedAt,
      origin: carrierChecked ? "third_party" : "ours",
    });
  }

  if (lead.email) {
    const mailboxChecked = Boolean(lead.contactVerifiedAt) && lead.emailStatus !== "unknown";
    rows.push({
      claim: `${lead.email} accepts mail`,
      how: mailboxChecked
        ? lead.emailStatus === "deliverable"
          ? "The mailbox was confirmed to exist"
          : lead.emailStatus === "risky"
            ? "The domain accepts mail but the mailbox could not be confirmed"
            : "The mailbox was rejected"
        : "Checked for syntax and a mail server only",
      when: lead.contactVerifiedAt,
      origin: mailboxChecked ? "third_party" : "ours",
    });
  }

  // --- Their website. Everything here we measured ourselves, which is the strongest
  // kind of evidence on the page and the reason the crawl is worth its cost.
  if (lead.siteAudited && lead.website) {
    rows.push({
      claim: lead.siteReachable ? "Their website is up" : "Their website did not respond",
      how: "We fetched their homepage and read it",
      when: lead.checkedAt,
      check: lead.website,
      origin: "ours",
    });

    if (lead.loadMs !== null) {
      rows.push({
        claim: `Homepage answered in ${(lead.loadMs / 1000).toFixed(1)}s`,
        // Said out loud, because a prospect can disprove a "your site is slow" claim in
        // one click and a rep should know the measurement includes our own network.
        how: "Measured from our server, so it includes the network path to us",
        when: lead.checkedAt,
        check: lead.website,
        origin: "ours",
      });
    }

    if (lead.hasSSL !== null) {
      rows.push({
        claim: lead.hasSSL ? "Site is served over HTTPS" : "Site is not served over HTTPS",
        how: "Observed on the homepage fetch",
        when: lead.checkedAt,
        check: lead.website,
        origin: "ours",
      });
    }

    if (lead.copyrightYear) {
      rows.push({
        claim: `Footer says ${lead.copyrightYear}`,
        how: "Read from their own homepage",
        when: lead.checkedAt,
        check: lead.website,
        origin: "theirs",
      });
    }

    if (lead.vendors?.length) {
      rows.push({
        claim: `Running ${lead.vendors.map((v) => v.name).join(", ")}`,
        how: "Detected from scripts and links on their homepage",
        when: lead.checkedAt,
        check: lead.website,
        origin: "ours",
      });
    }
  } else if (lead.website && !lead.siteAudited) {
    // The honest gap. A lead whose site we never reached is graded on contact details
    // only, and saying so here is what stops the empty site fields reading as a clean
    // bill of health.
    rows.push({
      claim: "We have not checked their website",
      how: "The search ran out of time before reaching it, so nothing below is graded on it",
      when: null,
      check: lead.website,
      origin: "ours",
    });
  }

  // --- Reputation, straight from the profile.
  if (lead.rating !== null && lead.reviewCount !== null) {
    rows.push({
      claim: `Rated ${lead.rating} across ${lead.reviewCount.toLocaleString()} reviews`,
      how: "Taken from their Google Business Profile",
      when: null,
      check: lead.mapUrl || undefined,
      origin: "theirs",
    });
  }

  // --- The owner. The most valuable field and the one most worth attributing, because
  // a rep is about to say this person's name out loud.
  if (lead.ownerName) {
    rows.push({
      claim: `${lead.ownerName}${lead.ownerRole ? `, ${lead.ownerRole}` : ""} runs this business`,
      how:
        lead.ownerSource === "site"
          ? "Their own website names them"
          : lead.ownerSource === "registry"
            ? `Named in a ${lead.ownerRegistry ?? "state"} business filing`
            : lead.ownerSource === "vendor"
              ? `From a third party database${lead.ownerConfidence ? `, ${lead.ownerConfidence}% confidence` : ""}`
              : "Found during our crawl of their site",
      when: lead.enrichedAt ?? null,
      check: lead.ownerSource === "site" ? lead.website || undefined : undefined,
      origin: lead.ownerSource === "vendor" ? "third_party" : lead.ownerSource === "site" ? "theirs" : "ours",
    });
  }

  if (lead.ownerEmail) {
    rows.push({
      claim: `${lead.ownerEmail} reaches them directly`,
      // Worth stating plainly: guessing an owner's address is standard in this
      // industry and shipping the guess unchecked is why bought lists bounce.
      how: "Confirmed deliverable before we showed it to you. We never publish a guessed address",
      when: lead.enrichedAt ?? null,
      origin: "third_party",
    });
  }

  if (lead.hiring) {
    rows.push({
      claim: "Actively hiring",
      how: "Found on their own careers page",
      when: lead.enrichedAt ?? null,
      check: lead.hiringUrl || undefined,
      origin: "theirs",
    });
  }

  // --- What changed. The one claim no standing database can make.
  for (const c of lead.changes ?? []) {
    rows.push({
      claim: c.label,
      how: "We have looked at this business more than once and this is what moved",
      when: c.since,
      origin: "ours",
    });
  }

  return rows;
}

/** Plain-English label for where a fact came from. */
export const ORIGIN_LABEL: Record<EvidenceRow["origin"], string> = {
  ours: "We checked",
  theirs: "They published",
  third_party: "Verified by a third party",
};
