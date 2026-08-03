import { send as sendEmail, configured } from "./provider";
import { shell, heading, paragraph, button, divider, escapeHtml } from "./template";
import { siteUrl } from "../site-url";

// Mail the product sends on its own behalf: a ticket arriving, a reply going back.
//
// Separate from lib/email/send.ts, which is the customer's own outreach and carries
// the customer's identity and unsubscribe rules. Nothing here is marketing, so nothing
// here has an unsubscribe link: an account you own telling you something happened on
// it is transactional, and CAN-SPAM's rules for commercial mail do not apply.
//
// Every function returns rather than throws. A notification that fails must never take
// down the thing it was announcing: a ticket that saved but could not be emailed about
// is far better than a ticket that was refused because the mail server was down.

const FROM_EMAIL = () => process.env.MFA_FROM_EMAIL || "security@fresh-leads.io";
const FROM_NAME = () => process.env.MFA_FROM_NAME || "Fresh Leads";

/** Where operator notifications go. Falls back to the admin address. */
const OPERATOR_EMAIL = () =>
  process.env.SUPPORT_NOTIFY_EMAIL || process.env.ADMIN_EMAIL || "info@fresh-leads.io";

const SITE = () => siteUrl();

/** A short, safe excerpt. The full thread is one click away and lives in the app. */
function excerpt(body: string, max = 400): string {
  const clean = body.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

/**
 * Tell the operator a customer is waiting.
 *
 * Without this, support is a queue nobody is told about, which is worse than no
 * support at all: the customer believes they have reached a person.
 */
export async function notifyOperatorOfTicket(input: {
  subject: string;
  topic: string;
  body: string;
  fromEmail: string;
  ticketId: string;
  isReply?: boolean;
}): Promise<boolean> {
  if (!configured()) return false;

  const what = input.isReply ? "replied on a ticket" : "opened a ticket";
  const url = `${SITE()}/admin/tickets`;

  const html = shell({
    preheader: `${input.fromEmail}: ${input.subject}`,
    body: [
      heading(`A customer ${what}`),
      paragraph(
        `<b>${escapeHtml(input.subject)}</b><br>` +
          `from ${escapeHtml(input.fromEmail)} &middot; ${escapeHtml(input.topic)}`
      ),
      paragraph(escapeHtml(excerpt(input.body)), true),
      button("Read and reply", url),
      divider(),
      paragraph("Replying in the admin panel puts your answer in their account.", true),
    ].join(""),
    footnote: "You are getting this because you operate this deployment.",
  });

  const result = await sendEmail({
    fromEmail: FROM_EMAIL(),
    fromName: FROM_NAME(),
    to: OPERATOR_EMAIL(),
    subject: `${input.isReply ? "Re: " : ""}${input.subject}`,
    html,
    text: [
      `A customer ${what}.`,
      "",
      input.subject,
      `from ${input.fromEmail} (${input.topic})`,
      "",
      excerpt(input.body),
      "",
      url,
    ].join("\n"),
    replyTo: input.fromEmail,
  });

  if (!result.ok) console.error("[notify] operator ticket mail failed:", result.error);
  return result.ok;
}

/**
 * Tell the customer their ticket has an answer.
 *
 * The reply itself is deliberately NOT quoted in full. Support threads carry account
 * details, and an inbox is a less private place than an account behind two factors.
 */
export async function notifyCustomerOfReply(input: {
  to: string;
  subject: string;
  ticketId: string;
}): Promise<boolean> {
  if (!configured()) return false;

  const url = `${SITE()}/dashboard/help/${input.ticketId}`;
  const html = shell({
    preheader: `We have replied about "${input.subject}"`,
    body: [
      heading("We have replied"),
      paragraph(`Your ticket: <b>${escapeHtml(input.subject)}</b>`),
      paragraph("The answer is waiting in your account. Writing back keeps it in the same thread."),
      button("Read the reply", url),
    ].join(""),
    footnote: `Sent to ${escapeHtml(input.to)} because you opened a support ticket.`,
  });

  const result = await sendEmail({
    fromEmail: FROM_EMAIL(),
    fromName: FROM_NAME(),
    to: input.to,
    subject: `Re: ${input.subject}`,
    html,
    text: [
      "We have replied to your ticket.",
      "",
      input.subject,
      "",
      `Read it here: ${url}`,
    ].join("\n"),
  });

  if (!result.ok) console.error("[notify] customer reply mail failed:", result.error);
  return result.ok;
}
