// Where this site actually lives.
//
// One resolver, because NEXT_PUBLIC_SITE_URL had been left pointing at the previous
// project's Vercel URL and nine separate files trusted it. The consequences were not
// obvious from any single one of them:
//
//   Stripe redirects   sent the customer to a deployment that no longer exists, so
//                      checkout ended on a 404 after they had paid
//   sitemap + robots   told search engines the whole site lived on a dead host
//   canonical tags     pointed every page at that host
//   passkeys           WebAuthn binds a key to an ORIGIN, so the browser refused to
//                      sign for the real domain
//   email links        every unsubscribe, digest and ticket link was dead
//
// A missing or wrong value should degrade to the right answer rather than quietly
// breaking payments, so the canonical domain is the floor rather than a guess.

const CANONICAL = "https://www.fresh-leads.io";

/**
 * The site's public base URL, without a trailing slash.
 *
 * A *.vercel.app value is REJECTED. Every use of this is something that must work at
 * the customer-facing domain: a payment redirect, a link in an email, the origin a
 * passkey is bound to, the canonical URL a search engine records. A deployment URL is
 * always the wrong answer for those, and always a misconfiguration rather than an
 * intention, so it is safer to override it than to honour it.
 *
 * Localhost is honoured, because development needs it.
 */
export function siteUrl(): string {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
  if (!configured) return CANONICAL;

  let host: string;
  try {
    host = new URL(configured).hostname;
  } catch {
    return CANONICAL;
  }

  if (host === "localhost" || host === "127.0.0.1") return configured;

  if (host.endsWith(".vercel.app")) {
    console.warn(
      `[site-url] NEXT_PUBLIC_SITE_URL is ${configured}, a deployment URL. ` +
        `Using ${CANONICAL} instead: payment redirects, email links and passkeys all break on a deployment host.`
    );
    return CANONICAL;
  }

  return configured;
}

/** The registrable host, which is what WebAuthn binds a key to. */
export function siteHost(): string {
  try {
    return new URL(siteUrl()).hostname;
  } catch {
    return "www.fresh-leads.io";
  }
}
