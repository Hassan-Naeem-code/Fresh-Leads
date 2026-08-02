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
