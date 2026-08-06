import { createAdminClient } from "./supabase/admin";
import type { TriggerKind } from "./snapshots";

// What changed at the businesses a customer has already opened.
//
// The detection has been running since migration 008 and the findings have been
// stored since 019, but the only places they surfaced were a chip on a lead and a
// weekly email. That makes the product's one genuinely uncopyable signal something
// you have to already be looking at a lead to notice.
//
// This is the read behind a screen of its own: everything that moved recently at a
// business this customer paid to open, newest first.

export type Change = {
  leadKey: string;
  business: string | null;
  city: string | null;
  phone: string | null;
  website: string | null;
  kind: TriggerKind;
  label: string;
  since: string;
  detectedOn: string;
};

/** How urgent is this, for sorting and for colour. */
export const URGENCY: Record<string, "act" | "watch"> = {
  site_went_down: "act",
  lost_own_site: "act",
  vendor_dropped: "act",
  booking_removed: "act",
  vendor_switched: "watch",
  vendor_adopted: "watch",
  booking_added: "watch",
  site_recovered: "watch",
  gained_own_site: "watch",
};

/**
 * Recent changes at businesses this user owns.
 *
 * Scoped by lead_unlocks, so a customer only ever sees movement at businesses they
 * have paid for. Showing change at a locked lead would be giving away the signal we
 * charge for, and showing change at somebody else's lead would be a data leak.
 */
export async function changesForUser(userId: string, withinDays = 30): Promise<Change[]> {
  const admin = createAdminClient();

  const { data: owned } = await admin
    .from("lead_unlocks")
    .select("lead_key")
    .eq("user_id", userId);

  const keys = [...new Set((owned ?? []).map((u) => u.lead_key as string))];
  if (keys.length === 0) return [];

  const since = new Date(Date.now() - withinDays * 86_400_000).toISOString().slice(0, 10);

  // Chunked: Postgrest builds the filter into the URL, and a customer with a few
  // thousand opened leads would otherwise produce a request too long to send.
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < keys.length; i += 200) {
    const { data } = await admin
      .from("business_triggers")
      .select("lead_key, kind, label, since, detected_on")
      .in("lead_key", keys.slice(i, i + 200))
      .gte("detected_on", since)
      .order("detected_on", { ascending: false });
    if (data) rows.push(...data);
  }
  if (rows.length === 0) return [];

  // Business names live on the leads row, keyed by source and source_id rather than
  // by lead_key, so the pair is rebuilt here.
  const sourceIds = [...new Set(rows.map((r) => String(r.lead_key).slice(String(r.lead_key).indexOf(":") + 1)))];
  const details = new Map<string, { name: string; city: string | null; phone: string | null; website: string | null }>();
  for (let i = 0; i < sourceIds.length; i += 200) {
    const { data } = await admin
      .from("leads")
      .select("source, source_id, name, city, phone, website")
      .eq("user_id", userId)
      .in("source_id", sourceIds.slice(i, i + 200));
    for (const l of data ?? []) {
      details.set(`${l.source}:${l.source_id}`, {
        name: l.name as string,
        city: (l.city as string) ?? null,
        phone: (l.phone as string) ?? null,
        website: (l.website as string) ?? null,
      });
    }
  }

  return rows.map((r) => {
    const key = r.lead_key as string;
    const d = details.get(key);
    return {
      leadKey: key,
      business: d?.name ?? null,
      city: d?.city ?? null,
      phone: d?.phone ?? null,
      website: d?.website ?? null,
      kind: r.kind as TriggerKind,
      label: r.label as string,
      since: r.since as string,
      detectedOn: r.detected_on as string,
    };
  });
}

/** Split into "call today" and "worth knowing", because they are different jobs. */
export function partition(changes: Change[]): { act: Change[]; watch: Change[] } {
  return {
    act: changes.filter((c) => URGENCY[c.kind] === "act"),
    watch: changes.filter((c) => URGENCY[c.kind] !== "act"),
  };
}

/**
 * What moved across the territories a customer watches, not only where they have paid.
 *
 * THE PROBLEM THIS SOLVES. changesForUser is scoped to lead_unlocks, so a subscriber who
 * has not opened anything yet sees an empty page, and somebody who opened three leads
 * sees movement at three businesses. The signal no standing database can sell was
 * therefore invisible until you had already bought enough of the product to notice it.
 *
 * WHERE THE LINE IS. A business you have opened shows what changed, in words you can say
 * on a call. A business you have not shows only THAT it changed, alongside its name and
 * town, exactly as a locked lead shows a grade and a signal count without the signals.
 * The specific change is the sellable part, and giving it away here would be selling the
 * product to nobody.
 *
 * That is also what makes this page worth returning to: it says twelve businesses in your
 * territory moved this week and you have opened three of them.
 */
export type TerritoryChange = {
  watchlistId: string;
  watchlistName: string;
  /** Businesses in this territory with at least one change in the window. */
  changed: number;
  /** How many of those the customer has already paid to open. */
  opened: number;
  /** The businesses themselves, locked unless owned. */
  businesses: {
    leadKey: string;
    name: string;
    city: string | null;
    changeCount: number;
    /** Present ONLY when this customer has opened the business. */
    labels: string[] | null;
  }[];
};

/**
 * Names and towns for a set of lead keys.
 *
 * Business detail lives on the leads row, keyed by source and source_id rather than by
 * lead_key, so the pair is rebuilt here. Deliberately NOT scoped to one customer: a
 * territory change can name a business somebody else discovered, and the name and town
 * of a local business are not private information. Anything that IS private, the phone
 * and the site, stays behind the unlock.
 */
async function businessDetails(
  leadKeys: string[]
): Promise<Map<string, { name: string; city: string | null }>> {
  const admin = createAdminClient();
  const out = new Map<string, { name: string; city: string | null }>();
  const sourceIds = [...new Set(leadKeys.map((k) => k.slice(k.indexOf(":") + 1)))];

  for (let i = 0; i < sourceIds.length; i += 200) {
    const { data } = await admin
      .from("leads")
      .select("source, source_id, name, city")
      .in("source_id", sourceIds.slice(i, i + 200));
    for (const l of data ?? []) {
      const key = `${l.source}:${l.source_id}`;
      if (!out.has(key)) out.set(key, { name: l.name as string, city: (l.city as string) ?? null });
    }
  }
  return out;
}

export async function territoryChanges(
  userId: string,
  withinDays = 30
): Promise<TerritoryChange[]> {
  const admin = createAdminClient();

  const { data: lists } = await admin
    .from("saved_searches")
    .select("id, label, niche, location")
    .eq("user_id", userId);
  if (!lists?.length) return [];

  const { data: owned } = await admin
    .from("lead_unlocks")
    .select("lead_key")
    .eq("user_id", userId);
  const ownedKeys = new Set((owned ?? []).map((r) => r.lead_key as string));

  const since = new Date(Date.now() - withinDays * 86_400_000).toISOString().slice(0, 10);
  const out: TerritoryChange[] = [];

  for (const list of lists) {
    // Which businesses this saved search has actually surfaced. A territory nobody has
    // run yet has no keys, and correctly reports nothing rather than guessing.
    const { data: seen } = await admin
      .from("watchlist_seen")
      .select("lead_key")
      .eq("watchlist_id", list.id as string)
      .limit(2000);
    const keys = [...new Set((seen ?? []).map((r) => r.lead_key as string))];
    if (keys.length === 0) continue;

    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < keys.length; i += 200) {
      const { data } = await admin
        .from("business_triggers")
        .select("lead_key, kind, label, since, detected_on")
        .in("lead_key", keys.slice(i, i + 200))
        .gte("detected_on", since)
        .order("detected_on", { ascending: false });
      if (data) rows.push(...data);
    }
    if (rows.length === 0) continue;

    const byKey = new Map<string, { kind: string; label: string }[]>();
    for (const r of rows) {
      const key = r.lead_key as string;
      const list = byKey.get(key) ?? [];
      list.push({ kind: r.kind as string, label: r.label as string });
      byKey.set(key, list);
    }

    const details = await businessDetails([...byKey.keys()]);
    const businesses = [...byKey.entries()]
      .map(([leadKey, changes]) => {
        const owned = ownedKeys.has(leadKey);
        const d = details.get(leadKey);
        return {
          leadKey,
          name: d?.name ?? "A business in this area",
          city: d?.city ?? null,
          changeCount: changes.length,
          // The words are the product. Only somebody who paid for this business gets them.
          labels: owned ? changes.map((c) => c.label) : null,
        };
      })
      // Urgency first, then the ones they already own, so the page opens on what is
      // actionable today rather than on whatever the database returned first.
      .sort((a, b) => Number(Boolean(b.labels)) - Number(Boolean(a.labels)) || b.changeCount - a.changeCount);

    out.push({
      watchlistId: list.id as string,
      watchlistName: (list.label as string) || `${list.niche} in ${list.location}`,
      changed: businesses.length,
      opened: businesses.filter((b) => b.labels).length,
      businesses: businesses.slice(0, 40),
    });
  }

  return out.sort((a, b) => b.changed - a.changed);
}
