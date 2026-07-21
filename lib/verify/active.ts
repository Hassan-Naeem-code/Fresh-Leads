import type { FreshnessLevel } from "../freshness";

// Best-effort "is this business actually operating?" signal, combined from what we
// already know: a source-provided business status (Google Places supplies this;
// OpenStreetMap does not), whether the website is live, and how fresh the listing
// is. Conservative: we only say "active" on positive evidence, and never bury a
// business as closed without it.
export type ActiveStatus = "active" | "uncertain" | "likely_closed";

export function assessActive(input: {
  businessStatus?: "operational" | "closed_temporarily" | "closed_permanently" | null;
  hasWebsite: boolean;
  siteReachable: boolean | null;
  freshness: FreshnessLevel;
}): ActiveStatus {
  if (input.businessStatus === "closed_permanently") return "likely_closed";
  if (input.businessStatus === "operational") return "active";

  // A live website is strong positive evidence.
  if (input.hasWebsite && input.siteReachable === true) return "active";
  // A very recent listing without a dead site is a good sign.
  if (input.freshness === "FRESH" || input.freshness === "RECENT") return "active";
  // Dead site or stale listing, not enough to call it closed, but flag it.
  if (input.siteReachable === false || input.freshness === "STALE") return "uncertain";
  return "uncertain";
}
