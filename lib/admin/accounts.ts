import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashPassword, verifyPassword } from "./password";

// The single admin credential, stored in public.admin_accounts (service-role only).
// First login is bootstrapped from ADMIN_EMAIL / ADMIN_PASSWORD env vars and then
// persisted, so a later password change survives.

type AdminAccount = { email: string; password_hash: string };

export async function getAdminAccount(): Promise<AdminAccount | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("admin_accounts")
    .select("email, password_hash")
    .eq("id", 1)
    .maybeSingle();
  return (data as AdminAccount) ?? null;
}

// Returns the canonical admin email on success, or null on failure.
export async function verifyAdminLogin(email: string, password: string): Promise<string | null> {
  const e = email.trim().toLowerCase();
  const row = await getAdminAccount();

  if (!row) {
    // Bootstrap: no row yet -> check the fixed env credentials and persist them.
    const envEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    const envPassword = process.env.ADMIN_PASSWORD || "";
    if (!envEmail || !envPassword) return null;
    if (e !== envEmail || password !== envPassword) return null;

    const admin = createAdminClient();
    await admin.from("admin_accounts").upsert({
      id: 1,
      email: envEmail,
      password_hash: hashPassword(password),
      updated_at: new Date().toISOString(),
    });
    return envEmail;
  }

  if (e !== row.email.toLowerCase()) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  return row.email;
}

export async function changeAdminPassword(
  email: string,
  currentPassword: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await getAdminAccount();
  if (!row) return { ok: false, error: "No admin account exists yet" };
  if (email.trim().toLowerCase() !== row.email.toLowerCase()) {
    return { ok: false, error: "Wrong account" };
  }
  if (!verifyPassword(currentPassword, row.password_hash)) {
    return { ok: false, error: "Current password is incorrect" };
  }
  if (newPassword.length < 8) {
    return { ok: false, error: "New password must be at least 8 characters" };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("admin_accounts")
    .update({ password_hash: hashPassword(newPassword), updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
