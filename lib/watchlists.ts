import { createAdminClient } from "./supabase/admin";

// WATCHLISTS: a market the customer is watching, rather than a search they ran once.
//
// The whole value is the second visit. A watchlist remembers every business it has
// already shown, so when it runs again it can say "these four are new" and, once
// snapshots have accumulated, "these two changed". That is the difference between a
// tool someone uses when they think of it and a service that gives them a reason to
// open the tab on Monday.

export type Watchlist = {
  id: string;
  name: string;
  niche: string;
  location: string;
  playbook: string | null;
  problem: string | null;
  lastRunAt: string | null;
  lastNewCount: number;
  seenCount: number;
  createdAt: string;
};

/** Cap per account. Each one is a market to re-scan, not a free-form bookmark list. */
export const MAX_WATCHLISTS = 25;

const defaultName = (niche: string, location: string) =>
  `${niche} in ${location}`.replace(/\s+/g, " ").trim().slice(0, 80);

export async function listWatchlists(userId: string): Promise<Watchlist[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("saved_searches")
    .select("id, name, niche, location, playbook, problem, last_run_at, last_new_count, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(MAX_WATCHLISTS);
  if (error) {
    console.error("[watchlists] list failed:", error.message);
    return [];
  }

  const rows = data ?? [];
  if (rows.length === 0) return [];

  // How many businesses each watchlist has shown so far, in one round trip rather
  // than one per card.
  const counts = new Map<string, number>();
  const { data: seen } = await admin
    .from("watchlist_seen")
    .select("saved_search_id")
    .in("saved_search_id", rows.map((r) => r.id as string))
    .limit(100_000);
  for (const s of seen ?? []) {
    const k = s.saved_search_id as string;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  return rows.map((r) => ({
    id: r.id as string,
    name: (r.name as string) || defaultName(r.niche as string, r.location as string),
    niche: r.niche as string,
    location: r.location as string,
    playbook: (r.playbook as string) ?? null,
    problem: (r.problem as string) ?? null,
    lastRunAt: (r.last_run_at as string) ?? null,
    lastNewCount: (r.last_new_count as number) ?? 0,
    seenCount: counts.get(r.id as string) ?? 0,
    createdAt: r.created_at as string,
  }));
}

/**
 * Save the search the customer just ran as a market to watch.
 *
 * Returns null when they are at the cap, so the caller can say so plainly rather than
 * silently doing nothing.
 */
export async function createWatchlist(
  userId: string,
  input: { niche: string; location: string; playbook?: string | null; problem?: string | null; name?: string }
): Promise<Watchlist | null> {
  const admin = createAdminClient();

  const { count } = await admin
    .from("saved_searches")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if ((count ?? 0) >= MAX_WATCHLISTS) return null;

  const { data, error } = await admin
    .from("saved_searches")
    .insert({
      user_id: userId,
      niche: input.niche,
      location: input.location,
      playbook: input.playbook ?? null,
      problem: input.problem ?? null,
      name: (input.name || defaultName(input.niche, input.location)).slice(0, 80),
    })
    .select("id, name, niche, location, playbook, problem, last_run_at, last_new_count, created_at")
    .maybeSingle();

  if (error || !data) {
    console.error("[watchlists] create failed:", error?.message);
    return null;
  }
  return {
    id: data.id as string,
    name: data.name as string,
    niche: data.niche as string,
    location: data.location as string,
    playbook: (data.playbook as string) ?? null,
    problem: (data.problem as string) ?? null,
    lastRunAt: null,
    lastNewCount: 0,
    seenCount: 0,
    createdAt: data.created_at as string,
  };
}

export async function deleteWatchlist(userId: string, id: string): Promise<boolean> {
  const admin = createAdminClient();
  // Scoped to the owner, so a guessed id cannot delete someone else's market.
  const { error } = await admin.from("saved_searches").delete().eq("id", id).eq("user_id", userId);
  if (error) {
    console.error("[watchlists] delete failed:", error.message);
    return false;
  }
  return true;
}

/** The businesses this watchlist has already shown. */
export async function seenKeys(watchlistId: string): Promise<Set<string>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("watchlist_seen")
    .select("lead_key")
    .eq("saved_search_id", watchlistId)
    .limit(100_000);
  if (error) {
    console.error("[watchlists] seen read failed:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => r.lead_key as string));
}

/**
 * Record what this run showed, and stamp the run.
 *
 * Called AFTER the caller has worked out which keys were new, because the moment
 * these rows exist those businesses stop counting as new. Conflicts are ignored: a
 * business already on the list keeps its original first_seen_at, which is what makes
 * "new" mean "new to you" rather than "seen most recently".
 *
 * Never throws. A watchlist that failed to record a run is a lost badge, not a lost
 * search, and the customer still has their results on screen.
 */
export async function markSeen(
  userId: string,
  watchlistId: string,
  leadKeys: string[],
  newCount: number
): Promise<void> {
  const admin = createAdminClient();
  try {
    // Confirm ownership before writing anything keyed to this watchlist.
    const { data: owned } = await admin
      .from("saved_searches")
      .select("id")
      .eq("id", watchlistId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!owned) return;

    if (leadKeys.length > 0) {
      await admin
        .from("watchlist_seen")
        .upsert(
          leadKeys.map((lead_key) => ({ saved_search_id: watchlistId, lead_key })),
          { onConflict: "saved_search_id,lead_key", ignoreDuplicates: true }
        );
    }

    await admin
      .from("saved_searches")
      .update({ last_run_at: new Date().toISOString(), last_new_count: newCount })
      .eq("id", watchlistId);
  } catch (e) {
    console.error("[watchlists] markSeen threw:", e);
  }
}

/** The watchlist itself, when the caller needs its saved filters to re-run it. */
export async function getWatchlist(userId: string, id: string): Promise<Watchlist | null> {
  const all = await listWatchlists(userId);
  return all.find((w) => w.id === id) ?? null;
}
