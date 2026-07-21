import type { LeadSource, RawLead } from "./types";
import { OverpassSource } from "./overpass-source";
import { GooglePlacesSource } from "./google-places-source";

// All configured sources, richest first. OSM is always on (free); Places joins
// automatically once GOOGLE_PLACES_API_KEY is set.
export function pickSources(): LeadSource[] {
  return [new GooglePlacesSource(), new OverpassSource()].filter((s) => s.isConfigured());
}

// Merge across sources, deduping by name+location and by phone, preferring the
// richer record (Places over OSM) when the same business appears twice.
//
// Each lead is indexed under SEVERAL keys, so a superseded record has to be
// retired from all of them at once. Repointing only the key that collided used to
// leave the loser alive under its other key and the same business came back twice,
// which then billed the customer twice for it. Keys therefore point at a slot id
// and the record lives in one place, so replacing it is a single write.
const RANK: Record<RawLead["source"], number> = { google_places: 2, osm: 1 };

/**
 * Fold two records of the same business into one.
 *
 * The sources are complementary rather than redundant: Places knows the phone,
 * the operating status and the Google Business Profile numbers, while OSM often
 * carries a published email address and a real last-edited timestamp. Picking one
 * whole record and discarding the other threw away contact details we had already
 * paid to discover, so identity comes from the richer source and every empty
 * field is filled from the other.
 */
function combine(a: RawLead, b: RawLead): RawLead {
  // Higher-ranked source owns the identity fields; ties keep `a`.
  const [primary, secondary] = RANK[b.source] > RANK[a.source] ? [b, a] : [a, b];
  const str = (x: string, y: string) => (x && x.trim() ? x : y);
  const num = (x: number | null, y: number | null) => (x !== null ? x : y);
  const bool = (x: boolean | null, y: boolean | null) => (x !== null ? x : y);

  return {
    ...primary,
    phone: str(primary.phone, secondary.phone),
    website: str(primary.website, secondary.website),
    email: str(primary.email, secondary.email),
    address: str(primary.address, secondary.address),
    city: str(primary.city, secondary.city),
    category: str(primary.category, secondary.category),
    // Keep whichever timestamp exists, OSM is usually the only one with it.
    lastUpdated: primary.lastUpdated ?? secondary.lastUpdated,
    businessStatus: primary.businessStatus ?? secondary.businessStatus,
    rating: num(primary.rating, secondary.rating),
    reviewCount: num(primary.reviewCount, secondary.reviewCount),
    hasHours: bool(primary.hasHours, secondary.hasHours),
    hasBooking: bool(primary.hasBooking, secondary.hasBooking),
    // If EITHER source could speak to websites, we know. This is why configuring
    // Places repairs the OSM blind spot instead of merely adding coverage.
    websiteKnown: primary.websiteKnown || secondary.websiteKnown,
  };
}

export function mergeRawLeads(lists: RawLead[][]): RawLead[] {
  const rank = RANK;

  const slots = new Map<number, RawLead>();
  const keyToSlot = new Map<string, number>();
  let nextSlot = 0;

  const keysFor = (l: RawLead) => {
    const geo = `${l.name.trim().toLowerCase()}|${l.lat.toFixed(3)}|${l.lon.toFixed(3)}`;
    // Compare the last 10 digits so a leading country code doesn't hide a match.
    const digits = l.phone ? l.phone.replace(/\D/g, "") : "";
    const phone = digits.length >= 10 ? `p:${digits.slice(-10)}` : null;
    return [geo, phone].filter(Boolean) as string[];
  };

  for (const list of lists) {
    for (const lead of list) {
      const keys = keysFor(lead);
      // A lead can collide with more than one existing slot (matching one by name
      // and another by phone). Those slots are all the same business, so fold
      // them together instead of leaving near-duplicates behind.
      const hitSlots = [...new Set(keys.map((k) => keyToSlot.get(k)).filter((s): s is number => s !== undefined))];

      if (hitSlots.length === 0) {
        const slot = nextSlot++;
        slots.set(slot, lead);
        for (const k of keys) keyToSlot.set(k, slot);
        continue;
      }

      const [keep, ...absorb] = hitSlots;
      // Collapse the extra slots into the first one.
      const absorbed = absorb.map((s) => slots.get(s)).filter((l): l is RawLead => Boolean(l));
      for (const s of absorb) slots.delete(s);
      for (const [k, s] of keyToSlot) if (absorb.includes(s)) keyToSlot.set(k, keep);

      const cur = slots.get(keep);
      const others = [...absorbed, ...(cur ? [cur] : [])];
      slots.set(keep, others.reduce(combine, lead));
      for (const k of keys) keyToSlot.set(k, keep);
    }
  }

  return [...slots.values()];
}

export type { RawLead, LeadSource } from "./types";
