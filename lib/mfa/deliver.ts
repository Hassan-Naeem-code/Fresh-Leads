import { send as sendEmail, configured as emailConfigured } from "../email/provider";

// Getting a code to the person.
//
// Both channels fail loudly rather than silently. A code that was never delivered but
// reported as sent leaves somebody staring at a box they can never fill, and with two
// factor required that means locked out of an account they are paying for.

const FROM_EMAIL = () => process.env.MFA_FROM_EMAIL || "security@fresh-leads.io";
const FROM_NAME = () => process.env.MFA_FROM_NAME || "Fresh Leads";

export const emailCodesAvailable = (): boolean => emailConfigured();
export const smsCodesAvailable = (): boolean =>
  Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);

export async function sendEmailCode(
  to: string,
  code: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!emailConfigured()) {
    return { ok: false, error: "Email codes are not available on this deployment." };
  }

  const text = [
    `Your sign in code is ${code}`,
    "",
    "It works once and expires in ten minutes.",
    "",
    "If you were not signing in, somebody has your password. Change it as soon as you can.",
  ].join("\n");

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px">
      <p style="font-size:15px;color:#333">Your sign in code is</p>
      <p style="font-size:34px;font-weight:700;letter-spacing:.12em;margin:12px 0">${code}</p>
      <p style="font-size:14px;color:#666">It works once and expires in ten minutes.</p>
      <p style="font-size:13px;color:#888;margin-top:22px">
        If you were not signing in, somebody has your password. Change it as soon as you can.
      </p>
    </div>`;

  const result = await sendEmail({
    fromEmail: FROM_EMAIL(),
    fromName: FROM_NAME(),
    to,
    subject: `${code} is your sign in code`,
    html,
    text,
  });

  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/**
 * Text a code through Twilio.
 *
 * Called directly rather than through the SDK: it is one form post, and the account
 * already holds Twilio credentials for phone verification.
 */
export async function sendSmsCode(
  toE164: string,
  code: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    return { ok: false, error: "Text message codes are not available on this deployment." };
  }

  const body = new URLSearchParams({
    To: toE164,
    From: from,
    Body: `${code} is your Fresh Leads sign in code. It expires in ten minutes.`,
  });

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      return { ok: false, error: (detail as { message?: string }).message || `Twilio said ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach Twilio." };
  }
}

/** j...@example.com, so the screen can say where a code went without printing it. */
export function maskEmail(address: string): string {
  const [name, domain] = address.split("@");
  if (!domain) return address;
  return `${name.slice(0, 1)}${".".repeat(Math.min(3, Math.max(1, name.length - 1)))}@${domain}`;
}

export const maskPhone = (e164: string): string => `xxx xxx ${e164.slice(-4)}`;
