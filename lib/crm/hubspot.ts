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
const BATCH_UPSERT = "https://api.hubapi.com/crm/v3/objects/companies/batch/upsert";

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

/** One lead as a HubSpot company record. */
function toCompany(lead: Lead) {
  return {
    idProperty: "domain",
    id: (lead.website || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0],
    properties: {
      name: lead.name,
      domain: (lead.website || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0],
      phone: lead.phone || "",
      city: lead.city || "",
      address: lead.address || "",
      industry: (lead.category || "").replace(/_/g, " "),
      description: lead.pitch || "",
    },
  };
}

export type PushResult = { pushed: number; skipped: number; error?: string };

/**
 * Send leads to HubSpot as companies, keyed on domain so a second push updates the
 * same record rather than creating a duplicate.
 *
 * Leads with no website are skipped and reported: HubSpot dedupes companies on domain,
 * and without one every push would create another copy of the same business.
 */
export async function pushLeads(userId: string, leads: Lead[]): Promise<PushResult> {
  const token = await activeToken(userId);
  if (!token) return { pushed: 0, skipped: leads.length, error: "not_connected" };

  const usable = leads.filter((l) => l.website);
  const skipped = leads.length - usable.length;
  if (usable.length === 0) return { pushed: 0, skipped };

  let pushed = 0;
  // HubSpot caps a batch at 100.
  for (let i = 0; i < usable.length; i += 100) {
    const chunk = usable.slice(i, i + 100);
    try {
      const res = await fetch(BATCH_UPSERT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: chunk.map(toCompany) }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        console.error("[hubspot] push failed:", res.status, (await res.text()).slice(0, 300));
        // Report what did land rather than pretending the whole push failed.
        return { pushed, skipped, error: res.status === 401 ? "not_connected" : "push_failed" };
      }
      pushed += chunk.length;
    } catch (e) {
      console.error("[hubspot] push threw:", e);
      return { pushed, skipped, error: "push_failed" };
    }
  }
  return { pushed, skipped };
}

export type { Connection };
