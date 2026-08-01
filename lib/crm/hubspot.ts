import type { Lead } from "../types";
import { getConnection, saveConnection, isExpired, type Connection } from "./store";

// HubSpot, spoken to directly rather than through their SDK, because we use three
// endpoints and the SDK is a large dependency for that.
//
// INACTIVE UNTIL CONFIGURED. With no client id and secret this reports "not
// configured" and the UI says so, exactly like the other optional integrations. The
// credentials are free from developers.hubspot.com.

const AUTH = "https://app.hubspot.com/oauth/authorize";
const TOKEN = "https://api.hubapi.com/oauth/v1/token";
const SEARCH = "https://api.hubapi.com/crm/v3/objects/companies/search";
const BATCH_CREATE = "https://api.hubapi.com/crm/v3/objects/companies/batch/create";
const BATCH_UPDATE = "https://api.hubapi.com/crm/v3/objects/companies/batch/update";

/**
 * What we ask for. Deliberately the minimum: permission to read and write companies,
 * and nothing else. A customer reviewing the consent screen should see a request that
 * matches what the product actually does.
 */
const SCOPES = ["crm.objects.companies.read", "crm.objects.companies.write", "oauth"];

export const hubspotConfigured = (): boolean =>
  Boolean(process.env.HUBSPOT_CLIENT_ID && process.env.HUBSPOT_CLIENT_SECRET);

export const redirectUri = (origin: string) => `${origin}/api/crm/hubspot/callback`;

/** Where to send the customer to approve the connection. */
export function authorizeUrl(origin: string, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.HUBSPOT_CLIENT_ID ?? "",
    redirect_uri: redirectUri(origin),
    scope: SCOPES.join(" "),
    state,
  });
  return `${AUTH}?${p.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse | null> {
  try {
    const res = await fetch(TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error("[hubspot] token request failed:", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    return (await res.json()) as TokenResponse;
  } catch (e) {
    console.error("[hubspot] token request threw:", e);
    return null;
  }
}

/** Swap the one time code from the callback for real tokens. */
export async function exchangeCode(origin: string, code: string): Promise<TokenResponse | null> {
  return tokenRequest({
    grant_type: "authorization_code",
    client_id: process.env.HUBSPOT_CLIENT_ID ?? "",
    client_secret: process.env.HUBSPOT_CLIENT_SECRET ?? "",
    redirect_uri: redirectUri(origin),
    code,
  });
}

/** Which portal these tokens belong to, so the UI can name the connection. */
export async function accountLabel(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${accessToken}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { hub_domain?: string; hub_id?: number };
    return d.hub_domain ?? (d.hub_id ? `Portal ${d.hub_id}` : null);
  } catch {
    return null;
  }
}

/**
 * Store a private app token.
 *
 * HubSpot disabled creating public OAuth apps through their UI in mid 2026, so a new
 * integration now needs their CLI and a project deploy. A private app token takes two
 * minutes from the settings screen instead, and for connecting your OWN HubSpot it is
 * the better tool: static, no expiry, no refresh cycle to get wrong.
 *
 * The limitation is real and is stated in the UI: a private app token reaches exactly
 * one HubSpot account. Customers connecting their own account still need the public
 * app, which is why the OAuth path above stays.
 */
export async function saveToken(userId: string, token: string): Promise<boolean> {
  // The oauth/access-tokens endpoint only describes OAuth tokens, so a service key
  // returns nothing there. Fall back to naming the credential type rather than
  // showing an empty connection.
  const label = await accountLabel(token);
  return saveConnection(userId, "hubspot", {
    accessToken: token.trim(),
    refreshToken: null,
    // No expiry: a service key and a private app token both stay valid until revoked,
    // so activeToken never tries to refresh them.
    expiresIn: null,
    accountLabel: label ?? "Service key",
  });
}

/** Does this token actually work, and which portal is it for? */
export async function checkToken(token: string): Promise<{ ok: boolean; label: string | null }> {
  try {
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/companies?limit=1", {
      headers: { Authorization: `Bearer ${token.trim()}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, label: null };
    return { ok: true, label: await accountLabel(token) };
  } catch {
    return { ok: false, label: null };
  }
}

/**
 * A usable access token, refreshing first if the stored one has expired.
 *
 * Returns null when there is no connection or the refresh failed, which the caller
 * reports as "reconnect your CRM" rather than as an error.
 */
export async function activeToken(userId: string): Promise<string | null> {
  const conn = await getConnection(userId, "hubspot");
  if (!conn) return null;
  if (!isExpired(conn)) return conn.accessToken;
  if (!conn.refreshToken) return null;

  const fresh = await tokenRequest({
    grant_type: "refresh_token",
    client_id: process.env.HUBSPOT_CLIENT_ID ?? "",
    client_secret: process.env.HUBSPOT_CLIENT_SECRET ?? "",
    refresh_token: conn.refreshToken,
  });
  if (!fresh) return null;

  await saveConnection(userId, "hubspot", {
    accessToken: fresh.access_token,
    // HubSpot may or may not rotate the refresh token. Keep the old one when it does not.
    refreshToken: fresh.refresh_token ?? conn.refreshToken,
    expiresIn: fresh.expires_in ?? null,
    accountLabel: conn.accountLabel,
  });
  return fresh.access_token;
}

/** The bare domain, which is what HubSpot matches companies on. */
export const domainOf = (website: string): string =>
  (website || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();

/**
 * One lead as HubSpot company properties.
 *
 * `industry` is deliberately NOT sent. HubSpot defines it as a fixed enumeration
 * (ACCOUNTING, AIRLINES_AVIATION and so on) and rejects the whole batch with a 400 if
 * the value is not one of theirs. Our categories come from OpenStreetMap and Google
 * Places as free text and will never match, so the trade is a failed push against a
 * field nobody asked for. The category goes in the description instead, where it is
 * still readable.
 */
export function companyProperties(lead: Pick<Lead, "name"|"website"|"phone"|"city"|"address"|"category"|"pitch">) {
  const category = (lead.category || "").replace(/_/g, " ").trim();
  const description = [category && `Category: ${category}`, lead.pitch]
    .filter(Boolean)
    .join(". ");
  return {
    name: lead.name,
    domain: domainOf(lead.website),
    phone: lead.phone || "",
    city: lead.city || "",
    address: lead.address || "",
    description,
  };
}

/**
 * Which of these domains HubSpot already has, as domain to record id.
 *
 * This exists because HubSpot's upsert endpoint only accepts a property the portal has
 * marked UNIQUE, and `domain` is not unique by default. Sending an upsert keyed on it
 * fails every time with a 400. Looking the domains up first and then splitting the work
 * into an update batch and a create batch does the same job with no portal
 * configuration required from the customer.
 */
async function existingByDomain(token: string, domains: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (domains.length === 0) return found;
  try {
    const res = await fetch(SEARCH, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: "domain", operator: "IN", values: domains }] }],
        properties: ["domain"],
        limit: 100,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return found;
    const data = (await res.json()) as { results?: Array<{ id: string; properties?: { domain?: string } }> };
    for (const r of data.results ?? []) {
      const d = (r.properties?.domain ?? "").toLowerCase();
      if (d) found.set(d, r.id);
    }
  } catch {
    // A failed lookup means we create rather than update. A duplicate is worse than
    // nothing, but far better than losing the push entirely, and the customer can
    // merge in HubSpot.
  }
  return found;
}

export type PushResult = { pushed: number; skipped: number; error?: string };

/**
 * Send leads to HubSpot as companies, matched on domain so pushing the same business
 * again updates its record rather than creating a second one.
 *
 * Leads with no website are skipped and reported: the domain is what the match is made
 * on, and without one every push would create another copy of the same business.
 *
 * KNOWN LIMIT, measured against a live portal: HubSpot's search index is eventually
 * consistent, roughly ten seconds behind a write. Pushing the same business twice
 * inside that window creates a duplicate, because the second push genuinely cannot see
 * the first. Repeats inside a single push are collapsed above, which covers the common
 * case; two separate pushes seconds apart is rare and recoverable by merging in
 * HubSpot. Avoiding it entirely would need `domain` marked unique in the customer's
 * portal, which is a setting we cannot make for them.
 */
export async function pushLeads(userId: string, leads: Lead[]): Promise<PushResult> {
  const token = await activeToken(userId);
  if (!token) return { pushed: 0, skipped: leads.length, error: "not_connected" };

  // Collapse repeats within this push. The same business can appear twice in a batch
  // (two searches, one list), and because HubSpot's search index is eventually
  // consistent the second copy would not yet be findable and would be created again.
  const byDomain = new Map<string, Lead>();
  for (const l of leads) {
    const d = domainOf(l.website);
    if (d) byDomain.set(d, l);
  }
  const usable = [...byDomain.values()];
  const skipped = leads.length - usable.length;
  if (usable.length === 0) return { pushed: 0, skipped };

  let pushed = 0;
  // HubSpot caps a batch at 100.
  for (let i = 0; i < usable.length; i += 100) {
    const chunk = usable.slice(i, i + 100);
    const existing = await existingByDomain(token, chunk.map((l) => domainOf(l.website)));

    const toUpdate = [];
    const toCreate = [];
    for (const lead of chunk) {
      const id = existing.get(domainOf(lead.website));
      if (id) toUpdate.push({ id, properties: companyProperties(lead) });
      else toCreate.push({ properties: companyProperties(lead) });
    }

    for (const [url, inputs] of [[BATCH_UPDATE, toUpdate], [BATCH_CREATE, toCreate]] as const) {
      if (inputs.length === 0) continue;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ inputs }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) {
          console.error("[hubspot] push failed:", res.status, (await res.text()).slice(0, 300));
          // Report what did land rather than pretending the whole push failed.
          return { pushed, skipped, error: res.status === 401 ? "not_connected" : "push_failed" };
        }
        pushed += inputs.length;
      } catch (e) {
        console.error("[hubspot] push threw:", e);
        return { pushed, skipped, error: "push_failed" };
      }
    }
  }
  return { pushed, skipped };
}

export type { Connection };
