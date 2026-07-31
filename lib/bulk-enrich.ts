import { auditWebsite } from "./audit";
import { enrichBusiness } from "./enrich";
import { verifyEmail } from "./verify/email";
import { verifyPhone } from "./verify/phone";
import { estimateSize } from "./size";
import { hostOf } from "./snapshots";

// BULK ENRICHMENT: the customer brings their own list, we fill in what is missing.
//
// This is the one service both competitors lead with that we did not have. It is the
// same machinery the search already runs, pointed at rows the customer supplies rather
// than businesses we discovered, so there is nothing new to keep correct.
//
// Two ways a row can be matched, cheapest first:
//   1. It already has a website. We audit it directly and pay nothing for discovery.
//   2. It has a name and a town. We ask Google Places to find it, which costs a
//      lookup, and only then audit.
//
// A row we cannot match is returned untouched and is NOT charged for. Billing for a
// row we failed on would be the same broken promise as charging for a dead phone
// number, and the product already refuses to do that.

export type InputRow = Record<string, string>;

export type EnrichedRow = InputRow & {
  fl_status: "enriched" | "not_found" | "no_input";
  fl_phone?: string;
  fl_phone_valid?: string;
  fl_email?: string;
  fl_email_status?: string;
  fl_website?: string;
  fl_owner?: string;
  fl_owner_role?: string;
  fl_owner_email?: string;
  fl_socials?: string;
  fl_hiring?: string;
  fl_size?: string;
  fl_vendors?: string;
  fl_site_reachable?: string;
  fl_has_booking?: string;
};

/** Header names customers actually use, mapped to what we need. */
const FIELD_ALIASES: Record<string, string[]> = {
  name: ["name", "business", "business name", "company", "company name", "account name"],
  website: ["website", "url", "web", "site", "domain", "website url"],
  city: ["city", "town", "location", "area", "address", "billing city"],
  phone: ["phone", "telephone", "phone number", "tel"],
  email: ["email", "e-mail", "email address"],
};

/** Find the column a row uses for one of our concepts, whatever they called it. */
export function pickField(row: InputRow, field: keyof typeof FIELD_ALIASES): string {
  const aliases = FIELD_ALIASES[field];
  for (const key of Object.keys(row)) {
    if (aliases.includes(key.trim().toLowerCase())) {
      const v = (row[key] ?? "").trim();
      if (v) return v;
    }
  }
  return "";
}

/**
 * Parse a CSV into rows keyed by header.
 *
 * Written rather than pulled in as a dependency because the input is our own export
 * format or a CRM's, both of which are well behaved. It handles the one thing that
 * actually breaks naive splitting: quoted fields containing commas and escaped quotes.
 */
export function parseCsv(text: string, maxRows = 1000): InputRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const src = text.replace(/^﻿/, "");   // strip the BOM Excel writes
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }   // "" is one literal quote
        else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(cell); cell = ""; continue; }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
      continue;
    }
    cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }

  const nonEmpty = rows.filter((r) => r.some((v) => v.trim()));
  if (nonEmpty.length < 2) return [];

  const headers = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1, maxRows + 1).map((r) => {
    const o: InputRow = {};
    headers.forEach((h, i) => { o[h] = (r[i] ?? "").trim(); });
    return o;
  });
}

/** Turn enriched rows back into a CSV, keeping the customer's own columns first. */
export function toCsv(rows: EnrichedRow[]): string {
  if (rows.length === 0) return "";
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;   // no spreadsheet formulas
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return [
    headers.map(esc).join(","),
    ...rows.map((r) => headers.map((h) => esc(r[h as keyof EnrichedRow])).join(",")),
  ].join("\r\n");
}

type Found = { website: string; phone: string; name: string; reviews: number | null; category: string };

/**
 * Ask Google Places to identify one business by name and town.
 *
 * Only reached for rows that arrived without a website, so a customer who supplies
 * their own URLs never pays for discovery at all.
 */
async function findBusiness(name: string, city: string): Promise<Found | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !name) return null;
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "places.displayName,places.websiteUri,places.nationalPhoneNumber," +
          "places.userRatingCount,places.primaryType",
      },
      body: JSON.stringify({ textQuery: [name, city].filter(Boolean).join(", "), maxResultCount: 1 }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      places?: Array<{
        displayName?: { text?: string }; websiteUri?: string;
        nationalPhoneNumber?: string; userRatingCount?: number; primaryType?: string;
      }>;
    };
    const p = data.places?.[0];
    if (!p) return null;
    return {
      website: p.websiteUri ?? "",
      phone: p.nationalPhoneNumber ?? "",
      name: p.displayName?.text ?? name,
      reviews: p.userRatingCount ?? null,
      category: p.primaryType ?? "",
    };
  } catch {
    return null;
  }
}

const yn = (v: boolean | null | undefined) => (v === null || v === undefined ? "" : v ? "yes" : "no");

/**
 * Enrich one row. Returns the row unchanged with a status when there was nothing to
 * work from or the business could not be identified, so the caller knows not to charge.
 */
export async function enrichRow(row: InputRow): Promise<EnrichedRow> {
  const name = pickField(row, "name");
  let website = pickField(row, "website");
  let phone = pickField(row, "phone");
  let email = pickField(row, "email");
  const city = pickField(row, "city");

  if (!website && !name) return { ...row, fl_status: "no_input" };

  let reviews: number | null = null;
  let category = "";

  if (!website) {
    const found = await findBusiness(name, city);
    if (!found) return { ...row, fl_status: "not_found" };
    website = found.website;
    phone = phone || found.phone;
    reviews = found.reviews;
    category = found.category;
  }

  const out: EnrichedRow = { ...row, fl_status: "enriched" };

  if (website) {
    out.fl_website = website;
    const [audit, extra] = await Promise.all([
      auditWebsite(website),
      enrichBusiness(website, { verifyGuesses: false }),
    ]);
    if (audit) {
      out.fl_site_reachable = yn(audit.reachable);
      out.fl_has_booking = yn(audit.hasBooking);
      if (audit.vendors?.length) out.fl_vendors = audit.vendors.map((v) => v.name).join("; ");
      if (!email && audit.email) email = audit.email;
    }
    if (extra.ownerName) {
      out.fl_owner = extra.ownerName;
      out.fl_owner_role = extra.ownerRole ?? "";
    }
    if (extra.ownerEmail) out.fl_owner_email = extra.ownerEmail;
    if (!email && extra.scrapedEmail) email = extra.scrapedEmail;
    if (Object.keys(extra.socials).length) out.fl_socials = Object.values(extra.socials).join("; ");
    if (extra.hiring !== null) out.fl_hiring = yn(extra.hiring);
  }

  // Paid verification, the same tier the unlock path uses, because this row IS the
  // thing being sold.
  if (phone) {
    out.fl_phone = phone;
    const v = await verifyPhone(phone, "US", { paid: true });
    out.fl_phone_valid = yn(v.valid);
  }
  if (email) {
    out.fl_email = email;
    const v = await verifyEmail(email, { paid: true });
    out.fl_email_status = v.status;
  }

  const size = estimateSize({ category, reviewCount: reviews, rating: null });
  if (size) out.fl_size = `${size.label} (${size.staff})`;

  // Keep the host handy: it is what a CRM dedupes on.
  const h = hostOf(website);
  if (h) out.fl_website = website.startsWith("http") ? website : `https://${h}`;

  return out;
}

/** How many rows were actually enriched, and so how many credits are owed. */
export const billableRows = (rows: EnrichedRow[]): number =>
  rows.filter((r) => r.fl_status === "enriched").length;
