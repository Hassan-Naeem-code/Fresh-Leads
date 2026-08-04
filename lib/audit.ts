// Lightweight, best-effort website audit. Fetches the homepage with a short timeout
// and extracts genuine "need" signals: SSL, mobile viewport, copyright year, and any
// real email published on the page.
//
// Accuracy rules (avoid false "down" signals):
//  - ANY HTTP response (even 403/401/429/500) means the site EXISTS and is up.
//    Only a network error or timeout counts as unreachable.
//  - Content signals (mobile/copyright/email) are only trusted on a 2xx HTML body;
//    otherwise they stay null (unknown) rather than fabricating a negative.

import { detectVendors, toVendorMatch, type VendorMatch } from "./vendors";

export type Audit = {
  reachable: boolean;
  hasSSL: boolean | null;
  mobileFriendly: boolean | null;
  copyrightYear: number | null;
  outdated: boolean | null;
  /**
   * Can a customer book or order online? Detected from booking-platform links and
   * booking call-to-action text. Only meaningful on a readable 2xx page, so it
   * stays null otherwise rather than claiming a business has no booking.
   */
  hasBooking: boolean | null;
  email: string;

  // --- Performance and SEO signals, all measured from the fetch we already do, so
  // they cost nothing extra and they fire often enough to be commercially useful.
  // The dead signals they replace (no HTTPS, no viewport tag) almost never fired:
  // measured on 189 real leads, no_ssl hit 0.5% and not_mobile 0%.
  /**
   * Milliseconds from request to a fully read body, measured server-side. A rough
   * proxy, not a lab metric: it includes our own network path. Treated as a signal
   * only well past any plausible noise (see SLOW_SITE_MS).
   */
  loadMs: number | null;
  /** Structured data (JSON-LD / microdata) that Google uses for rich results. */
  hasSchema: boolean | null;
  /** Any analytics or ad pixel at all. Without one they cannot measure anything. */
  hasAnalytics: boolean | null;
  /** Roughly how many words of real text the homepage has. */
  wordCount: number | null;
  scriptCount: number | null;
  /** Vendors and platforms detected in the page: POS, payments, ordering, booking… */
  vendors: VendorMatch[] | null;
};

/**
 * Above this, a homepage is slow enough to sell against. Deliberately generous: our
 * own latency is in the number, and a false "your site is slow" is the kind of claim
 * a prospect can disprove in one click.
 */
export const SLOW_SITE_MS = 2500;

/** Below this many words, a homepage has nothing for Google to rank. */
export const THIN_CONTENT_WORDS = 120;

/**
 * Blocking scripts above which a homepage is heavy enough to sell against, whatever
 * our own fetch time said. Calibrated on real sites: this flags the worst ~20%.
 */
export const HEAVY_SCRIPT_COUNT = 25;

const ANALYTICS_MARKERS = [
  "googletagmanager.com", "google-analytics.com", "gtag(", "ga(", "analytics.js",
  "connect.facebook.net", "fbq(", "clarity.ms", "hotjar.com", "plausible.io",
  "usefathom.com", "matomo", "piwik", "segment.com", "mixpanel", "posthog",
  "bing.com/bat.js", "snap.licdn.com", "tiktok.com/i18n/pixel",
];

function detectAnalytics(lower: string): boolean {
  return ANALYTICS_MARKERS.some((m) => lower.includes(m));
}

function detectSchema(html: string, lower: string): boolean {
  if (lower.includes("application/ld+json")) return true;
  // Microdata / RDFa fallbacks.
  return /itemtype=["']https?:\/\/schema\.org/i.test(html) || /vocab=["']https?:\/\/schema\.org/i.test(html);
}

/** Visible words, with script/style/markup stripped out. */
function countWords(html: string): number {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ");
  const words = text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w) && w.length > 1);
  return words.length;
}

// Third-party booking/scheduling platforms local businesses actually use, plus
// the self-hosted call-to-action wording. A hit on any of these means online
// booking exists, so the "they can't take bookings online" pitch does not apply.
const BOOKING_HOSTS = [
  "calendly.com", "acuityscheduling.com", "squareup.com/appointments", "square.site",
  "booksy.com", "vagaro.com", "styleseat.com", "schedulicity.com", "mindbodyonline.com",
  "setmore.com", "simplybook.me", "appointy.com", "10to8.com", "youcanbook.me",
  "opentable.com", "resy.com", "toasttab.com", "doordash.com", "ubereats.com",
  "grubhub.com", "chownow.com", "clover.com", "housecallpro.com", "servicetitan.com",
  "jobber.com", "getjobber.com", "zocdoc.com", "nexhealth.com", "tebra.com",
  "janeapp.com", "cliniko.com", "fresha.com", "treatwell.com", "gettimely.com",
];

const BOOKING_TEXT =
  /\b(book (now|online|an? appointment)|schedule (online|an? appointment|a visit)|request an? appointment|make a reservation|reserve a table|order online|book a table)\b/i;

function detectBooking(html: string, lower: string): boolean {
  if (BOOKING_HOSTS.some((h) => lower.includes(h))) return true;
  return BOOKING_TEXT.test(html);
}

const THIS_YEAR = new Date().getFullYear();

/** Local parts that only ever appear in placeholder text. */
const PLACEHOLDER_LOCALS = new Set([
  "user", "username", "name", "yourname", "your-name", "firstname", "lastname",
  "someone", "somebody", "example", "email", "youremail", "your-email", "mail",
  "address", "youraddress", "test", "testing", "demo", "sample", "placeholder",
  "no-reply", "noreply", "donotreply", "do-not-reply", "abc", "xyz", "foo", "bar",
]);

/** Domains that belong to templates, tooling or CDNs rather than the business. */
const PLACEHOLDER_DOMAINS = [
  "domain.com", "yourdomain.com", "your-domain.com", "example.com", "example.org",
  "example.net", "email.com", "youremail.com", "company.com", "yourcompany.com",
  "mycompany.com", "website.com", "yoursite.com", "site.com", "test.com",
  "sentry.io", "sentry-cdn.com", "wixpress.com", "wix.com", "squarespace.com",
  "godaddy.com", "cloudflare.com", "jquery.com", "googleapis.com", "gstatic.com",
  "schema.org", "w3.org", "adobe.com", "shopify.com", "wordpress.org",
];

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export function isPlaceholderEmail(email: string): boolean {
  const [local, domain] = email.toLowerCase().split("@");
  if (!local || !domain) return true;
  if (PLACEHOLDER_LOCALS.has(local)) return true;
  if (PLACEHOLDER_DOMAINS.some((d) => domain === d || domain.endsWith("." + d))) return true;
  // Image and asset filenames get caught by a naive email regex.
  if (/\.(png|jpe?g|gif|svg|webp|css|js|woff2?)$/i.test(domain)) return true;
  // Hashed/tracking addresses, e.g. 2a4f9c1e8b@sentry-something.
  if (/^[0-9a-f]{16,}$/i.test(local)) return true;
  return false;
}

/** Mail hosts a small business plausibly uses for its own inbox. */
const CONSUMER_MAIL_HOSTS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com",
  "live.com", "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "comcast.net",
  "sbcglobal.net", "att.net", "verizon.net", "bellsouth.net", "protonmail.com", "proton.me",
]);

/** Prefixes that signal a published business contact rather than a personal one. */
const ROLE_LOCALS = new Set([
  "info", "contact", "hello", "office", "admin", "sales", "book", "bookings",
  "reservations", "reserve", "orders", "frontdesk", "reception", "support", "team",
]);

/**
 * Pick the most credible published email on the page, by scoring every candidate
 * rather than taking whichever appears first in the HTML.
 *
 * Two real failures drove this. Taking the first match scraped "user@domain.com"
 * out of template boilerplate. Then simply preferring mailto: links surfaced
 * "eben@eyebytes.com" for a restaurant, which is the web agency that built the site,
 * while the business's actual "bettyjanesbarandgrill@gmail.com" sat further down the
 * page. Handing a customer their prospect's developer as the contact is worse than
 * handing them nothing.
 *
 * The scoring encodes what actually identifies a business's own inbox:
 *   - it is on their own domain, or
 *   - its local part echoes their brand, or
 *   - it is a role address, or
 *   - it is on a consumer mail host (small businesses really do run on Gmail)
 * and a foreign BUSINESS domain is penalised, because that is the agency case.
 */
export function pickBestEmail(html: string, lower: string, finalUrl: string): string {
  let siteDomain = "";
  try {
    siteDomain = new URL(finalUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    siteDomain = "";
  }
  // "bettyjanesbarandgrill" from "bettyjanesbarandgrill.com": the brand token.
  const brand = siteDomain.split(".")[0] ?? "";

  const candidates = new Map<string, number>(); // email -> best score seen

  const consider = (raw: string, fromMailto: boolean) => {
    const email = raw.toLowerCase().trim().replace(/[.,;:)]+$/, "");
    if (!email.includes("@") || isPlaceholderEmail(email)) return;
    const [local, domain] = email.split("@");
    if (!local || !domain) return;

    let score = 0;
    const onSite = domain === siteDomain || domain.endsWith("." + siteDomain) || siteDomain.endsWith("." + domain);
    if (onSite) score += 100;
    // Brand echoed in the local part, e.g. thebrand@gmail.com.
    else if (brand.length >= 5 && (local.includes(brand) || brand.includes(local))) score += 60;

    if (ROLE_LOCALS.has(local)) score += 20;
    if (fromMailto) score += 10; // an explicit "contact us" link
    if (CONSUMER_MAIL_HOSTS.has(domain)) score += 15;
    // A different business's domain: usually the agency, the theme author or a
    // partner, not the prospect.
    else if (!onSite) score -= 40;

    const prev = candidates.get(email);
    if (prev === undefined || score > prev) candidates.set(email, score);
  };

  for (const m of html.matchAll(/mailto:([^"'?\s>]+@[^"'?\s>]+)/gi)) consider(m[1], true);
  for (const e of lower.match(EMAIL_RE) ?? []) consider(e, false);

  if (candidates.size === 0) return "";
  const ranked = [...candidates.entries()].sort((a, b) => b[1] - a[1]);
  const [best, bestScore] = ranked[0];
  // A negative best means every candidate looked like somebody else's address.
  // Publishing nothing beats publishing the wrong company.
  return bestScore > 0 ? best : "";
}

/**
 * Fetch a page, giving up after timeoutMs, or sooner if `deadline` says so.
 *
 * The deadline exists because a per-attempt timeout does not bound a caller. This
 * function makes up to two attempts, auditWebsite makes up to four calls to it, and
 * 2 x (4 + 3 + 12 + 8) is 54 seconds for ONE site on a 60 second platform. That is
 * exactly what happened: the re-check pass had a 5 second budget, and the timings said
 * it ran for 50, because the budget only decided whether a site was STARTED. Once
 * started, one dead host owned the whole request.
 */
export async function fetchOnce(
  url: string,
  timeoutMs: number,
  deadline?: number
): Promise<Response | null> {
  if (deadline !== undefined) {
    const left = deadline - Date.now();
    if (left <= 0) return null;
    timeoutMs = Math.min(timeoutMs, left);
  }

  const attempt = async (headers: Record<string, string>): Promise<Response | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal, redirect: "follow", headers });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

  // Accept: */* and nothing narrower.
  //
  // This used to send "text/html,application/xhtml+xml", and that put some sites into
  // an INFINITE REDIRECT LOOP: a CDN doing content negotiation keeps redirecting to
  // satisfy an Accept it will not match, fetch gives up with "redirect count
  // exceeded", and the audit filed the site as UNREACHABLE.
  //
  // Measured on a real batch of 40 dentists: one site in ten marked "website down"
  // answered 200 in 68ms to the same request with */* instead. Sending the full Chrome
  // Accept string does NOT fix it, tested; anything containing text/html triggers it on
  // that host. That is the most damaging wrong output this product can make, because
  // the rep opens the call with something the owner disproves in one click.
  const res = await attempt({
    "User-Agent": UA,
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  });
  if (res) return res;

  // Only if there is time. The retry is worth having, but not at the price of the
  // request: a caller that is already out of budget wants an answer now.
  if (deadline !== undefined && Date.now() >= deadline) return null;

  // Last resort: no headers of ours at all. If some future host objects to one of the
  // three above the way this one objected to Accept, a bare request still gets an
  // honest answer, and honest is the whole point of the "is it down" claim.
  return attempt({});
}

/**
 * Crawl one business site and grade it.
 *
 * `deadline` is a wall-clock timestamp this call must not run past. Callers that run
 * many of these under a time budget MUST pass it: the fallbacks below are individually
 * modest and collectively longer than a serverless invocation is allowed to live.
 */
export async function auditWebsite(rawUrl: string, deadline?: number): Promise<Audit | null> {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  const hadScheme = /^https?:\/\//i.test(trimmed);
  const httpsUrl = hadScheme ? trimmed.replace(/^http:\/\//i, "https://") : "https://" + trimmed;
  const httpUrl = httpsUrl.replace(/^https:\/\//i, "http://");

  // Try HTTPS first (4s), then fall back to plain HTTP (3s). The fallback is the
  // whole point: a business still serving http-only fails the HTTPS fetch, and
  // treating that as unreachable used to score them "Website down, they're losing
  // customers this minute" when the truth is the far more sellable, and honest,
  // "no HTTPS". Only a site that answers on NEITHER scheme is really down.
  // Budgets stay tight so the pair still fits the serverless time limit.
  const startedAt = Date.now();
  const outOfTime = () => deadline !== undefined && Date.now() >= deadline;

  let res = await fetchOnce(httpsUrl, 4000, deadline);
  let servedOverHttps = res !== null;

  if (!res && !outOfTime()) {
    res = await fetchOnce(httpUrl, 3000, deadline);
    servedOverHttps = false;
  }

  // PATIENT RETRY before declaring a site dead.
  //
  // Measured on 60 real business sites, half of everything the fast pass called
  // "unreachable" answered fine when given more time. Those were slow hosts, not dead
  // ones, and calling them down produced the single most damaging kind of wrong
  // output this product can make: telling a customer a business is "losing customers
  // this minute" and having them open the pitch with something demonstrably false.
  //
  // The cost is bounded because it only runs for sites that already failed twice,
  // which is a small minority of any batch.
  //
  // Skipped when the budget is gone. A patient retry on a slow host is worth 12
  // seconds when there are 12 to spend and worth nothing when the whole search is
  // about to be cut off with no results at all.
  if (!res && !outOfTime()) {
    res = await fetchOnce(httpsUrl, 12000, deadline);
    servedOverHttps = res !== null;
    if (!res && !outOfTime()) {
      res = await fetchOnce(httpUrl, 8000, deadline);
      servedOverHttps = false;
    }
  }

  if (!res) {
    // Genuinely unreachable: neither scheme answered, twice, with a patient retry.
    return { reachable: false, hasSSL: null, mobileFriendly: null, copyrightYear: null, outdated: null,
             hasBooking: null, email: "", loadMs: null, hasSchema: null, hasAnalytics: null, wordCount: null,
             scriptCount: null, vendors: null };
  }

  // Trust the final URL after redirects (an http:// entry that 301s to HTTPS is a
  // secure site), and fall back to which scheme actually answered.
  const finalUrl = res.url || (servedOverHttps ? httpsUrl : httpUrl);
  const hasSSL = finalUrl.startsWith("https://");

  // Non-2xx: site is UP but we can't read content, leave content signals unknown.
  if (!res.ok) {
    return { reachable: true, hasSSL, mobileFriendly: null, copyrightYear: null, outdated: null,
             hasBooking: null, email: "", loadMs: null, hasSchema: null, hasAnalytics: null, wordCount: null,
             scriptCount: null, vendors: null };
  }

  // BOUNDED SEPARATELY. The abort timer above is cleared as soon as the headers land,
  // so a host that sends a 200 and then trickles the body forever was not covered by
  // any timeout at all. Losing the body costs the content signals; not losing it cost
  // the request.
  let html = "";
  try {
    const body = res.text().then((t) => t.slice(0, 200_000));
    const cap = deadline !== undefined ? Math.max(0, deadline - Date.now()) : 10_000;
    html = await Promise.race([
      body,
      new Promise<string>((resolve) => setTimeout(() => resolve(""), Math.min(cap, 10_000))),
    ]);
  } catch {
    return { reachable: true, hasSSL, mobileFriendly: null, copyrightYear: null, outdated: null,
             hasBooking: null, email: "", loadMs: null, hasSchema: null, hasAnalytics: null, wordCount: null,
             scriptCount: null, vendors: null };
  }
  const lower = html.toLowerCase();

  // The old check was just "is there a viewport tag", which 96% of real sites (44/46
  // measured) have, so it never fired. A fixed pixel width in the viewport is the
  // actual tell of a desktop-only layout, so count that as not mobile-friendly too.
  const viewportTag = html.match(/<meta[^>]+name=["']viewport["'][^>]*>/i)?.[0] ?? "";
  const viewportPinnedToDesktop = /width\s*=\s*["']?\s*\d{3,}/i.test(viewportTag);
  const mobileFriendly = Boolean(viewportTag) && !viewportPinnedToDesktop;

  // Most recent 4-digit year near a copyright/© marker.
  let copyrightYear: number | null = null;
  const years = [...html.matchAll(/(?:©|copyright|&copy;)[^0-9]{0,20}(20\d{2})/gi)].map((m) =>
    parseInt(m[1], 10)
  );
  if (years.length) copyrightYear = Math.max(...years);
  const outdated = copyrightYear != null && copyrightYear <= THIS_YEAR - 2;

  // Time to a fully read body. Measured per call: a module-level timestamp was
  // silently wrong here, because audits run 14+ at a time and each one overwrote the
  // others, which made every page look instant and the slow-site check never fire.
  const loadMs = Date.now() - startedAt;
  const hasBooking = detectBooking(html, lower);
  const hasSchema = detectSchema(html, lower);
  const hasAnalytics = detectAnalytics(lower);
  const wordCount = countWords(html);
  const scriptCount = (html.match(/<script\b[^>]*\bsrc=/gi) ?? []).length;
  const vendors = detectVendors(lower).map(toVendorMatch);

  // A genuine email actually published on the page, chosen rather than grabbed.
  //
  // Taking the first match found real placeholders straight out of template
  // boilerplate: a live search scraped "user@domain.com" from two different
  // restaurant sites and offered it to a customer as the lead's address. domain.com
  // even has MX records, so it passes the syntax and MX checks; only a paid
  // ZeroBounce lookup caught it, and ZeroBounce is exactly what stops working when
  // credits run out. So the filtering has to happen here, not downstream.
  const email = pickBestEmail(html, lower, finalUrl);

  return { reachable: true, hasSSL, mobileFriendly, copyrightYear, outdated, hasBooking, email,
           loadMs, hasSchema, hasAnalytics, wordCount, scriptCount, vendors };
}
