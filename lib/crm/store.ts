import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { createAdminClient } from "../supabase/admin";

// Storage for live OAuth credentials.
//
// Unlike an API key, an OAuth token has to be readable to be used, so it cannot be
// hashed. It is encrypted instead: AES-256-GCM, with the nonce and auth tag carried
// alongside the ciphertext. A leaked copy of the table is then useless without the
// key, which lives only in the environment.
//
// GCM rather than CBC because it authenticates as well as encrypts: a tampered
// ciphertext fails to decrypt instead of silently producing different bytes.

export type Provider = "hubspot" | "salesforce";

export type Connection = {
  provider: Provider;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  accountLabel: string | null;
  /**
   * Salesforce only. Every org lives on its own host, handed back with the tokens,
   * and a valid token sent to the wrong host fails. HubSpot has one endpoint for
   * everybody, so this stays null there.
   */
  instanceUrl: string | null;
  connectedAt: string;
};

/**
 * The encryption key, derived from a secret in the environment.
 *
 * Falls back to the service role key so a deployment that has not set a dedicated
 * secret still encrypts rather than storing tokens in the clear. Rotating the secret
 * invalidates stored connections, which is a reconnect, not a data loss.
 */
function key(): Buffer {
  const secret =
    process.env.CRM_TOKEN_SECRET ||
    process.env.ADMIN_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("No secret available to encrypt CRM tokens");
  return createHash("sha256").update(secret).digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  // iv.tag.ciphertext, each base64url, so the whole thing is one safe string.
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(packed: string): string | null {
  try {
    const [iv, tag, data] = packed.split(".").map((p) => Buffer.from(p, "base64url"));
    if (!iv || !tag || !data) return null;
    const d = createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString("utf8");
  } catch {
    // A wrong key or tampered value lands here. Treat it as "not connected" rather
    // than throwing: the customer reconnects and moves on.
    return null;
  }
}

export async function saveConnection(
  userId: string,
  provider: Provider,
  c: {
    accessToken: string;
    refreshToken?: string | null;
    expiresIn?: number | null;
    accountLabel?: string | null;
    instanceUrl?: string | null;
  }
): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin.from("crm_connections").upsert(
    {
      user_id: userId,
      provider,
      access_token: encrypt(c.accessToken),
      refresh_token: c.refreshToken ? encrypt(c.refreshToken) : null,
      expires_at: c.expiresIn ? new Date(Date.now() + c.expiresIn * 1000).toISOString() : null,
      account_label: c.accountLabel ?? null,
      instance_url: c.instanceUrl ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" }
  );
  if (error) {
    console.error("[crm] save failed:", error.message);
    return false;
  }
  return true;
}

export async function getConnection(userId: string, provider: Provider): Promise<Connection | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("crm_connections")
    .select("provider, access_token, refresh_token, expires_at, account_label, instance_url, connected_at")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (!data) return null;

  const accessToken = decrypt(data.access_token as string);
  if (!accessToken) return null;

  return {
    provider: data.provider as Provider,
    accessToken,
    refreshToken: data.refresh_token ? decrypt(data.refresh_token as string) : null,
    expiresAt: (data.expires_at as string) ?? null,
    accountLabel: (data.account_label as string) ?? null,
    instanceUrl: (data.instance_url as string) ?? null,
    connectedAt: data.connected_at as string,
  };
}

export async function deleteConnection(userId: string, provider: Provider): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("crm_connections")
    .delete()
    .eq("user_id", userId)
    .eq("provider", provider);
  return !error;
}

/** Is the stored access token past, or nearly past, its life? */
export const isExpired = (c: Connection): boolean =>
  Boolean(c.expiresAt && new Date(c.expiresAt).getTime() < Date.now() + 60_000);
