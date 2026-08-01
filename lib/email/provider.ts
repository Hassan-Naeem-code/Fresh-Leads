// The sending provider, behind one small interface.
//
// Resend today. Kept behind an interface because a sender is the thing most likely to
// be swapped: pricing changes, deliverability changes, and a domain that gets into
// trouble on one provider sometimes has to move.
//
// INACTIVE WITHOUT A KEY. `configured()` is false, `send()` refuses, and every screen
// says so. That is deliberate rather than defensive: half configured sending is how a
// domain reputation gets damaged, and the damage takes months to undo.

export type SendInput = {
  fromEmail: string;
  fromName: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Lets the provider group a thread and lets a webhook find our row again. */
  replyTo?: string | null;
  /** RFC 8058 one click unsubscribe, honoured by Gmail and Outlook. */
  unsubscribeUrl?: string | null;
};

export type SendResult =
  | { ok: true; providerId: string }
  | { ok: false; error: string; retryable: boolean };

export const configured = (): boolean => Boolean(process.env.RESEND_API_KEY);

/**
 * Send one message.
 *
 * Errors are classified rather than thrown. The send loop needs to know the difference
 * between "try again in a minute" (a 429 or a 500) and "never try again" (a rejected
 * address), because retrying the second kind forever is how a sender ends up on a
 * blocklist.
 */
export async function send(input: SendInput): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "No sending provider is configured.", retryable: false };

  const headers: Record<string, string> = {};
  if (input.unsubscribeUrl) {
    // Gmail and Outlook surface a native unsubscribe button when these are present,
    // and a one click opt out measurably reduces spam complaints.
    headers["List-Unsubscribe"] = `<${input.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${input.fromName} <${input.fromEmail}>`,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        reply_to: input.replyTo || undefined,
        headers: Object.keys(headers).length ? headers : undefined,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) {
      const data = (await res.json()) as { id?: string };
      return { ok: true, providerId: data.id ?? "" };
    }

    const body = (await res.text()).slice(0, 300);
    // 429 is rate limiting and 5xx is their side: both are worth another attempt.
    // 4xx otherwise means the request itself is wrong, and repeating it just annoys
    // the provider and delays the rest of the queue.
    const retryable = res.status === 429 || res.status >= 500;
    return { ok: false, error: `${res.status} ${body}`, retryable };
  } catch (e) {
    // A timeout or a dropped connection. The message may or may not have gone out, so
    // this is retryable only because the send loop keys on (enrollment, step) and the
    // database refuses a second row for the same one.
    return { ok: false, error: e instanceof Error ? e.message : "network error", retryable: true };
  }
}

/** Is this domain verified with the provider, and therefore safe to send from? */
export async function domainVerified(domain: string): Promise<boolean | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !domain) return null;
  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Array<{ name?: string; status?: string }> };
    const found = (data.data ?? []).find((d) => (d.name ?? "").toLowerCase() === domain.toLowerCase());
    // Null when we cannot tell, which the caller treats as not verified rather than
    // guessing in the permissive direction.
    return found ? found.status === "verified" : false;
  } catch {
    return null;
  }
}
