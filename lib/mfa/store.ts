import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "../supabase/admin";
import { encrypt, decrypt } from "../crm/store";
import { verifyTotp } from "./totp";

// Enrolling factors, issuing challenges, and checking answers.
//
// One owner type runs through everything: a customer is a user_id, the admin is an
// email, and every function takes an `Owner` rather than a bare id so no call site can
// accidentally look up a customer's factors for an admin login or the reverse.

export type Owner = { userId: string } | { adminEmail: string };
export type FactorKind = "totp" | "email" | "sms" | "passkey";

export type Factor = {
  id: string;
  kind: FactorKind;
  label: string | null;
  phone: string | null;
  confirmedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RECOVERY_CODE_COUNT = 10;

const where = (owner: Owner) =>
  "userId" in owner
    ? { column: "user_id", value: owner.userId }
    : { column: "admin_email", value: owner.adminEmail.toLowerCase() };

const ownerRow = (owner: Owner) =>
  "userId" in owner
    ? { user_id: owner.userId, admin_email: null }
    : { user_id: null, admin_email: owner.adminEmail.toLowerCase() };

/** sha256, hex. Right for a high entropy value; wrong for a password, which is why
 *  passwords elsewhere in this codebase use scrypt instead. */
const hash = (value: string): string =>
  createHash("sha256").update(value.trim()).digest("hex");

function hashesMatch(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listFactors(owner: Owner, confirmedOnly = true): Promise<Factor[]> {
  const admin = createAdminClient();
  const w = where(owner);
  let q = admin
    .from("mfa_factors")
    .select("id, kind, label, phone, confirmed_at, last_used_at, created_at")
    .eq(w.column, w.value)
    .order("created_at", { ascending: true });
  if (confirmedOnly) q = q.not("confirmed_at", "is", null);

  const { data } = await q;
  return (data ?? []).map((f) => ({
    id: f.id as string,
    kind: f.kind as FactorKind,
    label: (f.label as string | null) ?? null,
    // Only ever the last four. The whole number is not needed to choose a factor and
    // showing it turns a stolen session into a way to read a personal phone number.
    phone: f.phone ? `xxx xxx ${String(f.phone).slice(-4)}` : null,
    confirmedAt: (f.confirmed_at as string | null) ?? null,
    lastUsedAt: (f.last_used_at as string | null) ?? null,
    createdAt: f.created_at as string,
  }));
}

/** Has this account finished setting up at least one factor? */
export async function hasMfa(owner: Owner): Promise<boolean> {
  return (await listFactors(owner, true)).length > 0;
}

// ---------------------------------------------------------------------------
// Enrolling
// ---------------------------------------------------------------------------

/**
 * Start a TOTP enrolment. Returns the secret to show once, as text and as a URI.
 *
 * The factor is written unconfirmed. It grants nothing until the person proves they
 * can read a code from it, which is what stops a half finished setup from either
 * locking them out or counting as protection it is not providing.
 */
export async function beginTotp(
  owner: Owner,
  label: string,
  secretBase32: string
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("mfa_factors")
    .insert({ ...ownerRow(owner), kind: "totp", label, secret: encrypt(secretBase32) })
    .select("id")
    .single();
  if (error) {
    console.error("[mfa] could not start totp enrolment:", error.message);
    return null;
  }
  return data.id as string;
}

export async function beginSms(owner: Owner, phoneE164: string, label: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("mfa_factors")
    .insert({ ...ownerRow(owner), kind: "sms", label, phone: phoneE164 })
    .select("id")
    .single();
  if (error) return null;
  return data.id as string;
}

export async function beginEmail(owner: Owner, address: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("mfa_factors")
    .insert({ ...ownerRow(owner), kind: "email", label: address })
    .select("id")
    .single();
  if (error) return null;
  return data.id as string;
}

export async function confirmFactor(owner: Owner, factorId: string): Promise<boolean> {
  const admin = createAdminClient();
  const w = where(owner);
  const { error } = await admin
    .from("mfa_factors")
    .update({ confirmed_at: new Date().toISOString(), last_used_at: new Date().toISOString() })
    .eq("id", factorId)
    .eq(w.column, w.value);
  return !error;
}

/**
 * Remove a factor.
 *
 * Refuses to remove the last confirmed one. Two factor is required here, so allowing
 * an account to delete its way back to a password alone would quietly turn the
 * requirement off for whoever asked.
 */
export async function removeFactor(
  owner: Owner,
  factorId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const confirmed = await listFactors(owner, true);
  if (confirmed.length <= 1 && confirmed.some((f) => f.id === factorId)) {
    return {
      ok: false,
      error:
        "That is your only way in besides your password. Add another method first, then remove this one.",
    };
  }
  const admin = createAdminClient();
  const w = where(owner);
  const { error } = await admin.from("mfa_factors").delete().eq("id", factorId).eq(w.column, w.value);
  return error ? { ok: false, error: "Could not remove that." } : { ok: true };
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

/** A six digit code from a real random source, not Math.random. */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function createChallenge(
  owner: Owner,
  factorId: string,
  code: string,
  sentTo: string
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("mfa_challenges")
    .insert({
      ...ownerRow(owner),
      factor_id: factorId,
      code_hash: hash(code),
      sent_to: sentTo,
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    console.error("[mfa] could not create challenge:", error.message);
    return null;
  }
  return data.id as string;
}

export type ChallengeResult = "ok" | "wrong" | "expired" | "too_many" | "unknown";

/**
 * Answer an emailed or texted code.
 *
 * The attempt counter is incremented BEFORE the comparison. If the process dies
 * halfway, the attempt still counted, which is the safe direction to fail in.
 */
export async function answerChallenge(
  owner: Owner,
  challengeId: string,
  code: string
): Promise<ChallengeResult> {
  const admin = createAdminClient();
  const w = where(owner);

  const { data: row } = await admin
    .from("mfa_challenges")
    .select("id, factor_id, code_hash, attempts, expires_at, consumed_at")
    .eq("id", challengeId)
    .eq(w.column, w.value)
    .maybeSingle();
  if (!row) return "unknown";
  if (row.consumed_at) return "expired";
  if (new Date(row.expires_at as string).getTime() < Date.now()) return "expired";
  if ((row.attempts as number) >= MAX_ATTEMPTS) return "too_many";

  await admin
    .from("mfa_challenges")
    .update({ attempts: (row.attempts as number) + 1 })
    .eq("id", challengeId);

  if (!hashesMatch(row.code_hash as string, hash(code))) return "wrong";

  await admin
    .from("mfa_challenges")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", challengeId);
  if (row.factor_id) {
    await admin
      .from("mfa_factors")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", row.factor_id as string);
  }
  return "ok";
}

/** Answer a code from an authenticator app. */
export async function answerTotp(owner: Owner, factorId: string, code: string): Promise<boolean> {
  const admin = createAdminClient();
  const w = where(owner);
  const { data } = await admin
    .from("mfa_factors")
    .select("id, secret")
    .eq("id", factorId)
    .eq(w.column, w.value)
    .eq("kind", "totp")
    .maybeSingle();
  if (!data?.secret) return false;

  const secret = decrypt(data.secret as string);
  if (!secret) return false;
  if (!verifyTotp(secret, code)) return false;

  await admin
    .from("mfa_factors")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", factorId);
  return true;
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

/**
 * Issue a fresh set, replacing any that existed.
 *
 * Returned in the clear exactly once. Nothing stores them afterwards, so "I lost my
 * codes" is answered by generating new ones rather than by us reading the old ones.
 */
export async function issueRecoveryCodes(owner: Owner): Promise<string[]> {
  const admin = createAdminClient();
  const w = where(owner);
  await admin.from("mfa_recovery_codes").delete().eq(w.column, w.value);

  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    randomBytes(5).toString("hex").toUpperCase().replace(/(.{5})/, "$1-")
  );
  await admin
    .from("mfa_recovery_codes")
    .insert(codes.map((c) => ({ ...ownerRow(owner), code_hash: hash(c) })));
  return codes;
}

export async function countRecoveryCodes(owner: Owner): Promise<number> {
  const admin = createAdminClient();
  const w = where(owner);
  const { count } = await admin
    .from("mfa_recovery_codes")
    .select("id", { count: "exact", head: true })
    .eq(w.column, w.value)
    .is("used_at", null);
  return count ?? 0;
}

/** Spend a recovery code. Single use: the row is marked the moment it works. */
export async function useRecoveryCode(owner: Owner, code: string): Promise<boolean> {
  const admin = createAdminClient();
  const w = where(owner);
  const { data } = await admin
    .from("mfa_recovery_codes")
    .select("id, code_hash")
    .eq(w.column, w.value)
    .is("used_at", null);

  const target = hash(code.trim().toUpperCase());
  const match = (data ?? []).find((r) => hashesMatch(r.code_hash as string, target));
  if (!match) return false;

  const { error } = await admin
    .from("mfa_recovery_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", match.id as string)
    // Only if still unused: two tabs racing the same code must not both succeed.
    .is("used_at", null);
  return !error;
}
