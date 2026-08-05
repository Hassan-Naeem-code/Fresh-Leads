// Talking to state open data portals.
//
// Both registries we read run on Socrata, which answers plain HTTPS with JSON and needs
// no key for the volume one paid unlock generates. An app token would raise the throttle
// ceiling, so the code sends one if it is configured and works perfectly well without.

const TIMEOUT_MS = 6_000;

/**
 * A meaningful User-Agent, and not for politeness.
 *
 * The Overpass investigation earlier turned on exactly this: a request with no identity
 * was refused by both hosts, which looked like a hosting problem and was not. Public
 * data services throttle anonymous traffic harder than identified traffic, so anything
 * measured without a real agent string measures the wrong thing.
 */
const UA = "FreshLeads/1.0 (+https://www.fresh-leads.io; local business lead research)";

/**
 * GET a Socrata resource. Returns an empty array on anything that is not a clean
 * answer, because every caller is inside a paid unlock and none of them should fail
 * because a government portal is slow.
 */
export async function fetchJson<T>(url: string, params: Record<string, string>): Promise<T[]> {
  const query = new URLSearchParams(params).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const headers: Record<string, string> = { "User-Agent": UA, Accept: "application/json" };
  const token = process.env.SOCRATA_APP_TOKEN;
  if (token) headers["X-App-Token"] = token;

  try {
    const res = await fetch(`${url}?${query}`, { headers, signal: controller.signal });
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body) ? (body as T[]) : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
