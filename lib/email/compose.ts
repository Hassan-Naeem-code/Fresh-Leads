import { createHmac, timingSafeEqual } from "node:crypto";

// Turning a template into a message that is legal to send.
//
// Everything here is pure, because these are the rules that decide what lands in a
// stranger's inbox and they should be provable without a network or a database.
//
// The footer is not decoration. CAN-SPAM requires a working opt out and a real postal
// address in every commercial message, so composing a body and adding the footer are
// deliberately the same function: there is no way to produce a sendable body without
// one.

export type Recipient = {
  email: string;
  name?: string | null;
  business?: string | null;
  city?: string | null;
  ownerFirstName?: string | null;
};

export type Identity = {
  fromEmail: string;
  fromName: string;
  postalAddress: string;
};

/**
 * Merge tags, written the way a person would type them.
 *
 * An unknown tag is left visible rather than silently blanked: "Hi {{first_name}}"
 * arriving with an empty gap looks like a broken mail merge, but so does "Hi ,". The
 * fallback keeps it obviously wrong to the SENDER during preview instead of quietly
 * wrong to the recipient.
 */
export function merge(template: string, r: Recipient): string {
  const values: Record<string, string> = {
    business: r.business ?? "",
    city: r.city ?? "",
    first_name: (r.ownerFirstName ?? "").split(" ")[0] ?? "",
    owner: r.ownerFirstName ?? "",
  };
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, tag: string) => {
    const v = values[tag.toLowerCase()];
    return v !== undefined && v !== "" ? v : whole;
  });
}

/** Does this body still have unfilled tags? Used to stop a broken merge going out. */
export function unfilledTags(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((m) => m[1].toLowerCase());
}

const ESCAPE: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPE[c]);

/**
 * A one-off unsubscribe token, derived rather than stored.
 *
 * HMAC over the enrollment id means the link can be validated without a lookup, cannot
 * be guessed, and cannot be transferred to a different enrollment. It is minted when
 * the enrollment is created, so a message cannot exist without a way out of it.
 */
export function unsubscribeToken(enrollmentId: string, secret: string): string {
  return createHmac("sha256", secret).update(enrollmentId).digest("base64url");
}

/** Constant time compare, so a token cannot be discovered a character at a time. */
export function tokenMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type Composed = { subject: string; html: string; text: string };

/**
 * Build the final message.
 *
 * There is no option to omit the footer. A caller that wants to send without an
 * unsubscribe link has to not use this function, which makes that an obvious act
 * rather than a forgotten parameter.
 */
export function compose(
  step: { subject: string; body: string },
  r: Recipient,
  identity: Identity,
  unsubscribeUrl: string
): Composed {
  const subject = merge(step.subject, r);
  const bodyText = merge(step.body, r);

  const text = [
    bodyText,
    "",
    "---",
    `${identity.fromName}`,
    identity.postalAddress,
    "",
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");

  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");

  const html = [
    `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55;color:#231108">`,
    paragraphs,
    `<hr style="border:none;border-top:1px solid #e3d6c9;margin:22px 0 12px"/>`,
    `<div style="font-size:12px;color:#6e5d52">`,
    `${escapeHtml(identity.fromName)}<br/>`,
    `${escapeHtml(identity.postalAddress)}<br/><br/>`,
    `<a href="${escapeHtml(unsubscribeUrl)}" style="color:#6e5d52">Unsubscribe from these emails</a>`,
    `</div></div>`,
  ].join("");

  return { subject, html, text };
}

/**
 * Everything that must be true before a message may be sent.
 *
 * Returned as a list of reasons rather than a boolean, so the UI can say which rule
 * stopped it. Called at send time, not at compose time: an address can be suppressed
 * between building a campaign and running it.
 */
export function sendBlockers(input: {
  identityVerified: boolean;
  suppressed: boolean;
  toEmail: string;
  subject: string;
  body: string;
}): string[] {
  const out: string[] = [];
  if (!input.identityVerified) out.push("Your sending address is not verified yet.");
  if (input.suppressed) out.push("This address has unsubscribed or previously bounced.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.toEmail)) out.push("That is not a valid email address.");
  if (!input.subject.trim()) out.push("The subject line is empty.");
  if (!input.body.trim()) out.push("The message body is empty.");
  const missing = unfilledTags(input.body).concat(unfilledTags(input.subject));
  if (missing.length) out.push(`This message still has unfilled tags: ${[...new Set(missing)].join(", ")}.`);
  return out;
}
