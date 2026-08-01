import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// TOTP, RFC 6238, written out rather than pulled in.
//
// It is about forty lines of well specified arithmetic, and a dependency here would be
// a third party in the login path of every account forever. The parts that matter are
// the ones that are easy to get subtly wrong: the counter is big endian over 8 bytes,
// the dynamic truncation mask is 0x7f on the first byte, and verification has to allow
// the neighbouring windows because phone clocks drift.

const DIGITS = 6;
const PERIOD = 30;
/** How many 30 second windows either side of now are accepted. */
const DRIFT = 1;

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh 160 bit secret, which is what authenticator apps expect. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

function codeFor(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // Big endian, 64 bit. Written as two 32 bit halves because a JS number cannot hold
  // the whole thing exactly, and getting this wrong only shows up in the year 2038.
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const hmac = createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** The code an app would be showing right now. Exported for the tests. */
export function totpNow(secretBase32: string, at: number = Date.now()): string {
  return codeFor(base32Decode(secretBase32), Math.floor(at / 1000 / PERIOD));
}

/**
 * Does this code match, allowing for a phone clock that is slightly out?
 *
 * Compared with timingSafeEqual rather than ===, so the answer takes the same time
 * whether the first digit was wrong or only the last.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  at: number = Date.now()
): boolean {
  const cleaned = code.replace(/\D/g, "");
  if (cleaned.length !== DIGITS) return false;

  const secret = base32Decode(secretBase32);
  if (secret.length === 0) return false;

  const counter = Math.floor(at / 1000 / PERIOD);
  const given = Buffer.from(cleaned);
  let ok = false;
  for (let w = -DRIFT; w <= DRIFT; w++) {
    const expected = Buffer.from(codeFor(secret, counter + w));
    // No early return: every window is checked even after a match, so the time taken
    // does not reveal which one it was.
    if (expected.length === given.length && timingSafeEqual(expected, given)) ok = true;
  }
  return ok;
}

/**
 * The otpauth:// URI an authenticator app scans.
 *
 * The issuer appears twice on purpose: once as a label prefix, which is what older
 * apps read, and once as a parameter, which is what current ones use.
 */
export function otpauthUri(secretBase32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
