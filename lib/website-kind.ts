// What kind of web presence is behind a "website" field?
//
// Measured against Google Places, 75% of the businesses OpenStreetMap lists with no
// website tag DO have one, so an OSM absence is not evidence. Of the ones that really
// have no site of their own, a large share are running the business off a Facebook
// page or a DoorDash/Menufy ordering link. Both cases matter commercially:
//
//   * treating "OSM didn't say" as "no website" invents the biggest need signal we
//     have (55 points) out of missing data, and
//   * a business whose entire presence is a Facebook page is a genuinely strong
//     prospect, but only if we can name that specifically instead of filing it under
//     "has a website, nothing to sell".

/** Social profiles standing in for a website. */
const SOCIAL_HOSTS = [
  "facebook.com", "fb.me", "fb.com", "instagram.com", "twitter.com", "x.com",
  "linkedin.com", "tiktok.com", "youtube.com", "pinterest.com", "yelp.com",
  "nextdoor.com", "linktr.ee", "linkin.bio", "beacons.ai", "wa.me",
];

/** Ordering/booking marketplaces standing in for a website. */
const MARKETPLACE_HOSTS = [
  "doordash.com", "ubereats.com", "grubhub.com", "postmates.com", "seamless.com",
  "menufy.com", "toasttab.com", "clover.com", "slicelife.com", "chownow.com",
  "orderup.com", "square.site", "squareup.com", "ezcater.com", "opentable.com",
  "resy.com", "booksy.com", "vagaro.com", "styleseat.com", "fresha.com",
  "schedulicity.com", "zocdoc.com", "healthgrades.com", "wellness.com",
  "google.com", "sites.google.com", "business.site", "godaddysites.com",
  "wixsite.com", "weebly.com", "blogspot.com", "wordpress.com",
];

export type WebsiteKind =
  /** A real site on their own domain. */
  | "own_domain"
  /** Only a social profile (Facebook page, Linktree, …). */
  | "social_only"
  /** Only a marketplace/booking listing (DoorDash, Booksy, a Google site, …). */
  | "marketplace_only"
  /** No usable URL at all. */
  | "none";

function hostOf(url: string): string | null {
  try {
    const withScheme = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

const matches = (host: string, list: string[]) =>
  list.some((h) => host === h || host.endsWith(`.${h}`));

export function classifyWebsite(url: string): WebsiteKind {
  if (!url || !url.trim()) return "none";
  const host = hostOf(url);
  if (!host) return "none";
  if (matches(host, SOCIAL_HOSTS)) return "social_only";
  if (matches(host, MARKETPLACE_HOSTS)) return "marketplace_only";
  return "own_domain";
}

/** Only an own-domain site counts as "they have a website" for scoring purposes. */
export function isRealWebsite(url: string): boolean {
  return classifyWebsite(url) === "own_domain";
}
