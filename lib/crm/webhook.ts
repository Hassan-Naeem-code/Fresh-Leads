import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "../supabase/admin";
import type { Lead } from "../types";
import type { PushResult } from "./hubspot";

// SENDING LEADS ANYWHERE.
//
// One destination that speaks plain HTTP covers Zapier, Make, n8n, and a customer's own
// endpoint. Building a Zapier app instead would mean their review process, their
// platform, and something that only helps the customers who already use Zapier.
//
// WHY IT IS SIGNED. A Zapier catch-hook URL is not a secret. It travels through
// browsers, chat messages and screenshots, and anybody who learns one can post whatever
// they like into that customer's CRM. The signature is what lets the receiving end tell
// a real delivery from a fabricated one, and it costs one header.

/** Only the fields a downstream tool can act on. Deliberately not the whole Lead. */
type Payload = {
  name: string;
  category: string;
  city: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  grade: number;
  gradeMax: number;
  tier: string;
  signals: string[];
  pitch: string;
  owner: { name: string | null; role: string | null } | null;
  changes: { label: string; since: string }[];
  mapUrl: string;
};

const TIMEOUT_MS = 8_000;

export const newSecret = (): string => `whsec_${randomBytes(24).toString("base64url")}`;

/** The signature a receiver should expect. Exported so the docs and the tests agree. */
export function sign(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/**
 * Check a signature the way a receiver would.
 *
 * Here so our own tests verify the scheme rather than restating it, and so the docs can
 * show working code instead of prose somebody has to translate.
 */
export function verify(secret: string, header: string, body: string): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=").map((x) => x.trim()) as [string, string])
  );
  const ts = Number(parts.t);
  if (!Number.isFinite(ts) || !parts.v1) return false;
  // Five minutes, so a captured delivery cannot be replayed indefinitely.
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const expected = sign(secret, ts, body);
  const a = Buffer.from(parts.v1);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type Endpoint = { url: string; secret: string; active: boolean; lastStatus: number | null; lastError: string | null; lastSentAt: string | null };

export async function getEndpoint(userId: string): Promise<Endpoint | null> {
  const { data } = await createAdminClient()
    .from("webhook_endpoints")
    .select("url, secret, active, last_status, last_error, last_sent_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return {
    url: data.url as string,
    secret: data.secret as string,
    active: data.active as boolean,
    lastStatus: (data.last_status as number) ?? null,
    lastError: (data.last_error as string) ?? null,
    lastSentAt: (data.last_sent_at as string) ?? null,
  };
}

/**
 * Is this host somewhere only our own servers can reach?
 *
 * Exported so it can be tested against real addresses rather than by reading the source
 * and hoping. Without this check the endpoint is a way to make our servers fetch things
 * inside whatever network they run in, which is how a cloud metadata service ends up
 * being read by a stranger.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "metadata.google.internal") return true;

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return (
    a === 127 ||                        // loopback
    a === 10 ||                         // private
    a === 0 ||                          // this network
    (a === 192 && b === 168) ||         // private
    (a === 169 && b === 254) ||         // link local, and every cloud metadata service
    (a === 172 && b >= 16 && b <= 31)   // private
  );
}

/**
 * Save a destination.
 *
 * HTTPS only, and no private addresses. Without that check this endpoint is a way to
 * make our servers fetch things inside whatever network they run in, which is the
 * server-side request forgery every cloud provider's metadata service is vulnerable to.
 */
export async function saveEndpoint(
  userId: string,
  url: string
): Promise<{ ok: true; secret: string } | { ok: false; error: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { ok: false, error: "That does not look like a URL." };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: "The address has to start with https." };
  }
  if (isPrivateHost(parsed.hostname)) {
    return { ok: false, error: "That address is not reachable from the internet." };
  }

  const existing = await getEndpoint(userId);
  // The secret survives a URL change, so somebody moving their Zap does not have to
  // reconfigure the verification at the other end.
  const secret = existing?.secret ?? newSecret();

  const { error } = await createAdminClient()
    .from("webhook_endpoints")
    .upsert({ user_id: userId, url: parsed.toString(), secret, active: true }, { onConflict: "user_id" });
  if (error) return { ok: false, error: "Could not save that destination." };
  return { ok: true, secret };
}

export async function removeEndpoint(userId: string): Promise<boolean> {
  const { error } = await createAdminClient().from("webhook_endpoints").delete().eq("user_id", userId);
  return !error;
}

function payloadOf(lead: Lead): Payload {
  return {
    name: lead.name,
    category: lead.category ?? "",
    city: lead.city ?? "",
    address: lead.address ?? "",
    phone: lead.phone ?? "",
    email: lead.email ?? "",
    website: lead.website ?? "",
    grade: lead.score,
    gradeMax: lead.scoreMax,
    tier: lead.tier,
    signals: lead.needSignals ?? [],
    pitch: lead.pitch ?? "",
    owner: lead.ownerName ? { name: lead.ownerName, role: lead.ownerRole ?? null } : null,
    changes: (lead.changes ?? []).map((c) => ({ label: c.label, since: c.since })),
    mapUrl: lead.mapUrl ?? "",
  };
}

/**
 * Deliver a batch.
 *
 * One request with all of them rather than one per lead: a Zap that fires forty times
 * costs the customer forty tasks against their plan, and most of them charge per task.
 */
export async function pushLeads(userId: string, leads: Lead[]): Promise<PushResult> {
  const endpoint = await getEndpoint(userId);
  if (!endpoint || !endpoint.active) return { pushed: 0, skipped: leads.length, error: "not_connected" };
  if (leads.length === 0) return { pushed: 0, skipped: 0 };

  const body = JSON.stringify({
    source: "fresh-leads",
    sentAt: new Date().toISOString(),
    count: leads.length,
    leads: leads.map(payloadOf),
  });
  const timestamp = Math.floor(Date.now() / 1000);

  const admin = createAdminClient();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "FreshLeads-Webhook/1.0",
        "X-FreshLeads-Signature": `t=${timestamp},v1=${sign(endpoint.secret, timestamp, body)}`,
      },
      body,
      signal: controller.signal,
    });

    await admin
      .from("webhook_endpoints")
      .update({
        last_sent_at: new Date().toISOString(),
        last_status: res.status,
        last_error: res.ok ? null : `The destination answered ${res.status}.`,
      })
      .eq("user_id", userId);

    if (!res.ok) {
      return { pushed: 0, skipped: leads.length, error: `The destination answered ${res.status}.` };
    }
    return { pushed: leads.length, skipped: 0 };
  } catch (e) {
    const message = controller.signal.aborted ? "The destination did not answer in time." : "Could not reach the destination.";
    await admin
      .from("webhook_endpoints")
      .update({ last_sent_at: new Date().toISOString(), last_status: null, last_error: message })
      .eq("user_id", userId);
    return { pushed: 0, skipped: leads.length, error: message };
  } finally {
    clearTimeout(timer);
  }
}
