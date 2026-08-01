import type { Lead } from "../types";
import { getConnection, saveConnection, isExpired } from "./store";

// Salesforce, for customers who live in it.
//
// Two things make this fiddlier than HubSpot:
//
//   1. Every org has its OWN host, handed back with the tokens as instance_url. A
//      valid token against the wrong host fails, so the host is stored and used.
//   2. There is no upsert on an arbitrary field without a custom External Id, so the
//      same search-then-write shape as HubSpot is used: find what exists, update those,
//      create the rest.
//
// Leads are written as the LEAD object rather than Account. A business we found and
// graded but have never spoken to is exactly what a Salesforce Lead is for, and it
// converts into Account, Contact and Opportunity later if the customer wins it.

const LOGIN = "https://login.salesforce.com";

const SCOPES = ["api", "refresh_token", "offline_access"];

export const salesforceConfigured = (): boolean =>
  Boolean(process.env.SALESFORCE_CLIENT_ID && process.env.SALESFORCE_CLIENT_SECRET);

export const redirectUri = (origin: string) => `${origin}/api/crm/salesforce/callback`;

export function authorizeUrl(origin: string, state: string): string {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: process.env.SALESFORCE_CLIENT_ID ?? "",
    redirect_uri: redirectUri(origin),
    scope: SCOPES.join(" "),
    state,
  });
  return `${LOGIN}/services/oauth2/authorize?${p.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  instance_url?: string;
  issued_at?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse | null> {
  try {
    const res = await fetch(`${LOGIN}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      console.error("[salesforce] token request failed:", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    return (await res.json()) as TokenResponse;
  } catch (e) {
    console.error("[salesforce] token request threw:", e);
    return null;
  }
}

export async function exchangeCode(origin: string, code: string): Promise<TokenResponse | null> {
  return tokenRequest({
    grant_type: "authorization_code",
    client_id: process.env.SALESFORCE_CLIENT_ID ?? "",
    client_secret: process.env.SALESFORCE_CLIENT_SECRET ?? "",
    redirect_uri: redirectUri(origin),
    code,
  });
}

/**
 * A usable token AND the host to send it to.
 *
 * Salesforce access tokens do not carry an expiry we can read, so `isExpired` is only
 * a hint. A 401 on the first call triggers a refresh and one retry, which is the only
 * reliable signal that a token has gone stale.
 */
async function auth(userId: string): Promise<{ token: string; instance: string } | null> {
  const conn = await getConnection(userId, "salesforce");
  if (!conn || !conn.instanceUrl) return null;
  if (!isExpired(conn)) return { token: conn.accessToken, instance: conn.instanceUrl };
  return refresh(userId);
}

async function refresh(userId: string): Promise<{ token: string; instance: string } | null> {
  const conn = await getConnection(userId, "salesforce");
  if (!conn?.refreshToken) return null;

  const fresh = await tokenRequest({
    grant_type: "refresh_token",
    client_id: process.env.SALESFORCE_CLIENT_ID ?? "",
    client_secret: process.env.SALESFORCE_CLIENT_SECRET ?? "",
    refresh_token: conn.refreshToken,
  });
  if (!fresh) return null;

  const instance = fresh.instance_url ?? conn.instanceUrl ?? "";
  await saveConnection(userId, "salesforce", {
    accessToken: fresh.access_token,
    // Salesforce does not reissue the refresh token, so the original is kept.
    refreshToken: conn.refreshToken,
    expiresIn: null,
    accountLabel: conn.accountLabel,
    instanceUrl: instance,
  });
  return { token: fresh.access_token, instance };
}

/** A Salesforce Lead. Company and LastName are both required by the object. */
function toLead(lead: Lead) {
  const owner = (lead.ownerName ?? "").trim();
  const parts = owner.split(/\s+/);
  return {
    Company: lead.name,
    // LastName is mandatory. With no named owner the business name stands in, which
    // is what a rep sees anyway when they open an unworked lead.
    LastName: parts.length > 1 ? parts.slice(1).join(" ") : owner || lead.name,
    ...(parts.length > 1 ? { FirstName: parts[0] } : {}),
    ...(lead.ownerEmail || lead.email ? { Email: lead.ownerEmail || lead.email } : {}),
    ...(lead.phone ? { Phone: lead.phone } : {}),
    ...(lead.website ? { Website: lead.website } : {}),
    ...(lead.city ? { City: lead.city } : {}),
    ...(lead.address ? { Street: lead.address } : {}),
    LeadSource: "Fresh Leads",
    Description: [
      (lead.category || "").replace(/_/g, " ") && `Category: ${(lead.category || "").replace(/_/g, " ")}`,
      lead.pitch,
    ].filter(Boolean).join(". "),
  };
}

export type PushResult = { pushed: number; skipped: number; error?: string };

const escapeSoql = (v: string) => v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** Which of these websites already exist as Leads, as website to record id. */
async function existingByWebsite(
  token: string,
  instance: string,
  websites: string[]
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (websites.length === 0) return found;
  try {
    const list = websites.map((w) => `'${escapeSoql(w)}'`).join(",");
    const soql = `SELECT Id, Website FROM Lead WHERE Website IN (${list}) AND IsConverted = false`;
    const res = await fetch(`${instance}/services/data/v62.0/query?q=${encodeURIComponent(soql)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return found;
    const data = (await res.json()) as { records?: Array<{ Id: string; Website?: string }> };
    for (const r of data.records ?? []) {
      if (r.Website) found.set(r.Website.toLowerCase(), r.Id);
    }
  } catch {
    // A failed lookup means we create rather than update. A duplicate is recoverable
    // in Salesforce; a lost push is not.
  }
  return found;
}

export async function pushLeads(userId: string, leads: Lead[]): Promise<PushResult> {
  let a = await auth(userId);
  if (!a) return { pushed: 0, skipped: leads.length, error: "not_connected" };

  // One record per business, so a list containing the same one twice writes once.
  const byWebsite = new Map<string, Lead>();
  const noWebsite: Lead[] = [];
  for (const l of leads) {
    if (l.website) byWebsite.set(l.website.toLowerCase(), l);
    else noWebsite.push(l);
  }
  const usable = [...byWebsite.values(), ...noWebsite];
  if (usable.length === 0) return { pushed: 0, skipped: leads.length };

  const skipped = leads.length - usable.length;
  let pushed = 0;

  // Composite tops out at 200 records.
  for (let i = 0; i < usable.length; i += 200) {
    const chunk = usable.slice(i, i + 200);
    const existing = await existingByWebsite(
      a.token, a.instance, chunk.filter((l) => l.website).map((l) => l.website.toLowerCase())
    );

    const updates = [];
    const creates = [];
    for (const lead of chunk) {
      const id = lead.website ? existing.get(lead.website.toLowerCase()) : undefined;
      if (id) updates.push({ attributes: { type: "Lead" }, Id: id, ...toLead(lead) });
      else creates.push({ attributes: { type: "Lead" }, ...toLead(lead) });
    }

    for (const [method, records] of [["PATCH", updates], ["POST", creates]] as const) {
      if (records.length === 0) continue;
      const run = async (token: string, instance: string) =>
        fetch(`${instance}/services/data/v62.0/composite/sobjects`, {
          method,
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ allOrNone: false, records }),
          signal: AbortSignal.timeout(25_000),
        });

      let res = await run(a.token, a.instance);
      // A 401 is the only reliable sign the token expired, so refresh once and retry.
      if (res.status === 401) {
        const again = await refresh(userId);
        if (!again) return { pushed, skipped, error: "not_connected" };
        a = again;
        res = await run(a.token, a.instance);
      }

      if (!res.ok) {
        console.error("[salesforce] push failed:", res.status, (await res.text()).slice(0, 300));
        return { pushed, skipped, error: res.status === 401 ? "not_connected" : "push_failed" };
      }
      // allOrNone false means each record reports its own outcome, so count the ones
      // that actually landed rather than assuming the batch size.
      const results = (await res.json()) as Array<{ success?: boolean }>;
      pushed += results.filter((r) => r.success).length;
    }
  }
  return { pushed, skipped };
}
