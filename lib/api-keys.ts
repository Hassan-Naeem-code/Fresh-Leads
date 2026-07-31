import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "./supabase/admin";

// Programmatic access. The customer creates a key, sends it as a bearer token, and
// gets the same leads the dashboard shows, on the same credits.
//
// The key is shown once and never stored. We keep a SHA-256 hash, the way a password
// is kept, so a leaked copy of the table is not a set of working credentials. A plain
// hash with no salt is correct here and would be wrong for a password: the key is 32
// bytes of randomness, so there is no dictionary to attack and nothing for a salt to
// defend against, and an unsalted hash is what lets a lookup be a single indexed query
// rather than a scan of every row.

const PREFIX = "fl_live_";

export type ApiKeyRecord = {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export const hashKey = (key: string): string =>
  createHash("sha256").update(key, "utf8").digest("hex");

/**
 * Mint a key. Returns the full secret exactly once; after this call it exists only as
 * a hash and nobody, including us, can recover it.
 */
export async function createApiKey(
  userId: string,
  label: string
): Promise<{ key: string; record: ApiKeyRecord } | null> {
  const secret = PREFIX + randomBytes(24).toString("base64url");
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("api_keys")
    .insert({
      user_id: userId,
      label: label.slice(0, 60) || "API key",
      prefix: secret.slice(0, 10),
      key_hash: hashKey(secret),
    })
    .select("id, label, prefix, created_at, last_used_at, revoked_at")
    .maybeSingle();

  if (error || !data) {
    console.error("[api-keys] create failed:", error?.message);
    return null;
  }
  return { key: secret, record: toRecord(data) };
}

const toRecord = (r: Record<string, unknown>): ApiKeyRecord => ({
  id: r.id as string,
  label: r.label as string,
  prefix: r.prefix as string,
  createdAt: r.created_at as string,
  lastUsedAt: (r.last_used_at as string) ?? null,
  revokedAt: (r.revoked_at as string) ?? null,
});

export async function listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("api_keys")
    .select("id, label, prefix, created_at, last_used_at, revoked_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []).map(toRecord);
}

/** Revoke rather than delete, so a key that was used stays in the record. */
export async function revokeApiKey(userId: string, id: string): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (error) {
    console.error("[api-keys] revoke failed:", error.message);
    return false;
  }
  return true;
}

/**
 * Resolve a bearer token to the user it belongs to, or null.
 *
 * Revoked keys are excluded by the query rather than filtered afterwards, so a
 * revocation takes effect on the very next request with no cache to expire.
 */
export async function userIdForApiKey(rawHeader: string | null): Promise<string | null> {
  if (!rawHeader) return null;
  const key = rawHeader.replace(/^Bearer\s+/i, "").trim();
  if (!key.startsWith(PREFIX)) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("api_keys")
    .select("id, user_id")
    .eq("key_hash", hashKey(key))
    .is("revoked_at", null)
    .maybeSingle();

  if (!data) return null;

  // Best effort, and deliberately not awaited into the critical path: a failed
  // timestamp write must never cost the customer their request.
  admin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id as string)
    .then(undefined, () => {});

  return data.user_id as string;
}
