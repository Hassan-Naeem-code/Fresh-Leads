import { createAdminClient } from "./supabase/admin";

// Personal settings: how the product addresses you and what it does by default.
//
// Separate from the buyer profile (lib/buyer-profile.ts), which is about what you
// sell and drives scoring. These are about you. They share the profiles row because
// it is already per-user and already cascades on delete, but they are different
// questions and are kept apart in the interface for that reason.

export type Preferences = {
  displayName: string;
  defaultResultCount: number | null;
  notifyProductNews: boolean;
  notifyWeeklyDigest: boolean;
};

export const RESULT_COUNT_CHOICES = [10, 20, 40, 60, 80];

const DEFAULTS: Preferences = {
  displayName: "",
  defaultResultCount: null,
  notifyProductNews: true,
  notifyWeeklyDigest: true,
};

export async function getPreferences(userId: string): Promise<Preferences> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("display_name, default_result_count, notify_product_news, notify_weekly_digest")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return { ...DEFAULTS };

  return {
    displayName: (data.display_name as string | null) ?? "",
    defaultResultCount: (data.default_result_count as number | null) ?? null,
    // A missing column value means "not set", and the answer to that is the default,
    // not false. Silently opting somebody out is a bug that looks like a preference.
    notifyProductNews: data.notify_product_news !== false,
    notifyWeeklyDigest: data.notify_weekly_digest !== false,
  };
}

export async function savePreferences(
  userId: string,
  patch: Partial<Preferences>
): Promise<Preferences> {
  const admin = createAdminClient();

  const row: Record<string, unknown> = { preferences_updated_at: new Date().toISOString() };
  if (patch.displayName !== undefined) {
    row.display_name = patch.displayName.trim().slice(0, 80) || null;
  }
  if (patch.defaultResultCount !== undefined) {
    // Anything outside what the database allows is stored as "no preference" rather
    // than rejected: a bad number here is not worth failing a save over.
    const n = patch.defaultResultCount;
    row.default_result_count = n !== null && n >= 5 && n <= 80 ? Math.round(n) : null;
  }
  if (patch.notifyProductNews !== undefined) row.notify_product_news = patch.notifyProductNews;
  if (patch.notifyWeeklyDigest !== undefined) row.notify_weekly_digest = patch.notifyWeeklyDigest;

  const { error } = await admin.from("profiles").update(row).eq("id", userId);
  if (error) {
    console.error("[preferences] save failed:", error.message);
    throw new Error("Could not save your settings");
  }
  return getPreferences(userId);
}
