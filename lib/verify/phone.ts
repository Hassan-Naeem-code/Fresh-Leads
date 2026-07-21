import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

// Phone validation with two tiers:
//   1. Free floor (always on): pure, offline libphonenumber parse, proves the
//      number is well-formed and gives its line type. Does NOT prove the line is live.
//   2. Paid upgrade (TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN set): Twilio Lookup v2
//      confirms the number is real and dialable and returns carrier-grade line type.
//      Falls back to the free floor if keys are missing, the call errors, or it times out.
export type PhoneVerdict = {
  valid: boolean;
  e164: string;
  national: string;
  type: string | null; // mobile | fixed_line | voip | toll_free | ...
  reachable: boolean | null; // null until a paid lookup confirms the line is real
  source: "heuristic" | "twilio";
};

const FAKE = /^(\d)\1{6,}$/; // 0000000000, 1111111111, ...

// Twilio's line_type_intelligence vocabulary → ours.
const TWILIO_TYPE: Record<string, string> = {
  landline: "fixed_line",
  mobile: "mobile",
  fixedVoip: "voip",
  nonFixedVoip: "voip",
  tollFree: "toll_free",
  premium: "premium",
  sharedCost: "shared_cost",
  personal: "personal",
  uan: "uan",
  voicemail: "voicemail",
};

// Per-instance cache, repeated numbers in a batch shouldn't each cost a lookup.
const cache = new Map<string, PhoneVerdict>();

async function twilioLookup(e164: string): Promise<{ valid: boolean; type: string | null } | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}?Fields=line_type_intelligence`;
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` }, signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      valid?: boolean;
      line_type_intelligence?: { type?: string | null };
    };
    const raw = data.line_type_intelligence?.type ?? null;
    const type = raw ? TWILIO_TYPE[raw] ?? raw : null;
    return { valid: data.valid === true, type };
  } catch {
    return null; // network error / timeout / abort → fall back to heuristic
  } finally {
    clearTimeout(timer);
  }
}

/**
 * True when a cached verdict came from the free tier but a paid lookup could still
 * improve it. Only a well-formed number ever reaches Twilio, so anything already
 * rejected offline is final and must NOT be re-billed.
 *
 * Without this the cache would silently defeat verify-on-unlock: the search caches a
 * free verdict, then the unlock's paid call gets that cache hit back and never dials
 * Twilio at all.
 */
const canUpgrade = (v: PhoneVerdict) => v.valid && v.source === "heuristic";

export async function verifyPhone(
  raw: string,
  region: CountryCode = "US",
  /** `paid: false` stays on the free offline tier and never spends a Twilio lookup. */
  opts: { paid?: boolean } = {}
): Promise<PhoneVerdict> {
  const paid = opts.paid !== false;
  const empty: PhoneVerdict = { valid: false, e164: "", national: "", type: null, reachable: null, source: "heuristic" };
  if (!raw) return empty;

  const digits = raw.replace(/\D/g, "");
  if (!digits || FAKE.test(digits)) return empty;

  const parsed = parsePhoneNumberFromString(raw, region);
  if (!parsed || !parsed.isValid()) return empty;

  const base: PhoneVerdict = {
    valid: true,
    e164: parsed.number,
    national: parsed.formatNational(),
    type: parsed.getType() ?? "unknown",
    reachable: null,
    source: "heuristic",
  };

  const hit = cache.get(base.e164);
  if (hit && !(paid && canUpgrade(hit))) return hit;

  if (!paid) {
    cache.set(base.e164, base);
    return base;
  }

  // Twilio confirms the line is real and dialable, and refines the line type.
  const tw = await twilioLookup(base.e164);
  const verdict: PhoneVerdict = tw
    ? { ...base, type: tw.type ?? base.type, reachable: tw.valid, source: "twilio" }
    : base;

  cache.set(base.e164, verdict);
  return verdict;
}
