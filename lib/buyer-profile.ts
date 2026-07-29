import { createAdminClient } from "./supabase/admin";
import { DEFAULT_PLAYBOOK, playbookById, type BuyerProfile, type PlaybookId } from "./playbooks";

// Load and save what the user sells. This is the most important fact about a
// customer: it decides which signals their leads are scored on at all, so it belongs
// in the database rather than in client state that resets on reload.

const MAX_TARGETS = 12;

export async function getBuyerProfile(userId: string): Promise<BuyerProfile> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("playbook, sells, targets, search_location")
    .eq("id", userId)
    .maybeSingle();

  const playbook = (data?.playbook as PlaybookId | null) ?? DEFAULT_PLAYBOOK;
  return {
    // playbookById falls back to the default for an unknown id, so a stale row can
    // never leave a user unable to search.
    playbook: playbookById(playbook).id,
    sells: (data?.sells as string | null) ?? "",
    targets: (data?.targets as string[] | null) ?? [],
    location: (data?.search_location as string | null) ?? "",
  };
}

export async function saveBuyerProfile(
  userId: string,
  profile: Partial<BuyerProfile>
): Promise<BuyerProfile> {
  const admin = createAdminClient();

  const patch: Record<string, unknown> = { profile_updated_at: new Date().toISOString() };
  // Only write what was actually provided, so a partial save can't blank the rest.
  if (profile.playbook !== undefined) patch.playbook = playbookById(profile.playbook).id;
  if (profile.sells !== undefined) patch.sells = profile.sells.slice(0, 500);
  if (profile.targets !== undefined) {
    patch.targets = profile.targets
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, MAX_TARGETS);
  }
  if (profile.location !== undefined) patch.search_location = profile.location.slice(0, 160);

  const { error } = await admin.from("profiles").update(patch).eq("id", userId);
  if (error) {
    console.error("[buyer-profile] save failed:", error.message);
    throw new Error("Could not save your profile");
  }
  return getBuyerProfile(userId);
}
