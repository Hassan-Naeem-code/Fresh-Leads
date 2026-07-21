import { promises as dns } from "dns";
import { DISPOSABLE_DOMAINS, ROLE_PREFIXES } from "./disposable-domains";

// Email verification with two tiers:
//   1. Free floor (always on): syntax, disposable-domain, and MX-record checks.
//      No SMTP session (port 25 is blocked on Vercel), so a syntactically valid
//      address with MX records is at best "risky", probably reachable, not proven.
//   2. Paid upgrade (ZEROBOUNCE_API_KEY set): a real mailbox-level check that can
//      return a proven "deliverable" or "undeliverable". Falls back to the free
//      floor if the key is missing, the call errors, or it times out.
export type EmailStatus = "deliverable" | "risky" | "undeliverable" | "unknown";

export type EmailVerdict = {
  status: EmailStatus;
  syntaxOk: boolean;
  mxOk: boolean;
  disposable: boolean;
  role: boolean;
  source: "heuristic" | "zerobounce";
};

const SYNTAX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Per-instance caches, the same domain/email often recurs across a batch, and an
// email's status rarely changes minute-to-minute, so caching saves ZeroBounce credits.
const mxCache = new Map<string, boolean>();
const verdictCache = new Map<string, EmailVerdict>();

async function hasMx(domain: string): Promise<boolean> {
  if (mxCache.has(domain)) return mxCache.get(domain)!;
  let ok = false;
  try {
    const records = await dns.resolveMx(domain);
    ok = Array.isArray(records) && records.length > 0;
  } catch {
    ok = false;
  }
  mxCache.set(domain, ok);
  return ok;
}

/** Map ZeroBounce's status vocabulary onto ours. Returns null on any failure so
 *  the caller falls back to the heuristic verdict. */
async function zeroBounce(email: string): Promise<EmailStatus | null> {
  const key = process.env.ZEROBOUNCE_API_KEY;
  if (!key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const url =
      `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(key)}` +
      `&email=${encodeURIComponent(email)}&ip_address=`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { status?: string };
    switch (data.status) {
      case "valid":
        return "deliverable";
      case "invalid":
      case "spamtrap":
      case "abuse":
      case "do_not_mail":
        return "undeliverable";
      case "catch-all":
      case "unknown":
        return "risky";
      default:
        return "risky";
    }
  } catch {
    return null; // network error / timeout / abort → fall back to heuristic
  } finally {
    clearTimeout(timer);
  }
}

/**
 * True when a cached verdict came from the free tier but ZeroBounce could still
 * improve it. Only a syntax-and-MX pass ever reaches the paid tier, and that always
 * caps out at "risky" — so anything already ruled undeliverable offline is final and
 * must NOT be re-billed.
 *
 * Without this the cache would silently defeat verify-on-unlock: the search caches a
 * free verdict, then the unlock's paid call gets that cache hit back and never calls
 * ZeroBounce at all.
 */
const canUpgrade = (v: EmailVerdict) => v.source === "heuristic" && v.status === "risky";

export async function verifyEmail(
  email: string,
  /** `paid: false` stays on the free tier and never spends a ZeroBounce credit. */
  opts: { paid?: boolean } = {}
): Promise<EmailVerdict> {
  const paid = opts.paid !== false;
  const e = (email || "").trim().toLowerCase();
  if (!e)
    return { status: "unknown", syntaxOk: false, mxOk: false, disposable: false, role: false, source: "heuristic" };

  const hit = verdictCache.get(e);
  if (hit && !(paid && canUpgrade(hit))) return hit;

  const syntaxOk = SYNTAX.test(e);
  const [local, domain] = e.split("@");
  const disposable = !!domain && DISPOSABLE_DOMAINS.has(domain);
  const role = !!local && ROLE_PREFIXES.has(local);

  const finish = (v: EmailVerdict) => {
    verdictCache.set(e, v);
    return v;
  };

  if (!syntaxOk || disposable) {
    return finish({ status: "undeliverable", syntaxOk, mxOk: false, disposable, role, source: "heuristic" });
  }

  const mxOk = await hasMx(domain);
  if (!mxOk) return finish({ status: "undeliverable", syntaxOk, mxOk, disposable, role, source: "heuristic" });

  // Syntax + MX pass. If ZeroBounce is configured, get a proven verdict; else cap at "risky".
  if (!paid) return finish({ status: "risky", syntaxOk, mxOk, disposable, role, source: "heuristic" });
  const zb = await zeroBounce(e);
  if (zb) return finish({ status: zb, syntaxOk, mxOk, disposable, role, source: "zerobounce" });
  return finish({ status: "risky", syntaxOk, mxOk, disposable, role, source: "heuristic" });
}
