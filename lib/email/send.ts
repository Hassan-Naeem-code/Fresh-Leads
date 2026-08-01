import { createAdminClient } from "../supabase/admin";
import { compose, sendBlockers, unsubscribeToken, type Recipient, type Identity } from "./compose";
import { suppressedAmong, suppress } from "./suppression";
import { send as providerSend, configured } from "./provider";

// The send loop.
//
// Runs on a schedule, takes whatever is due, and sends it. Everything about it is
// arranged around not sending the wrong thing:
//
//   * The suppression list is checked in the same tick as the send, not when the
//     campaign was built. Someone can unsubscribe between those two moments.
//   * A message row is written BEFORE the provider call. The unique index on
//     (enrollment, step) is what makes an overlapping run a no-op instead of a second
//     copy in someone's inbox.
//   * A permanent failure stops the enrollment. Retrying a rejected address forever is
//     how a sender ends up on a blocklist.

const BATCH = 50;

export const tokenSecret = (): string =>
  process.env.EMAIL_TOKEN_SECRET ||
  process.env.ADMIN_SESSION_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";

export const unsubscribeUrl = (enrollmentId: string, origin: string): string =>
  `${origin}/unsubscribe?e=${enrollmentId}&t=${unsubscribeToken(enrollmentId, tokenSecret())}`;

type Due = {
  id: string;
  user_id: string;
  sequence_id: string;
  to_email: string;
  to_name: string | null;
  lead_key: string;
  last_step: number;
};

export type RunSummary = {
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
  reasons: Record<string, number>;
};

/**
 * Send everything that is due.
 *
 * Returns a summary rather than throwing, because this is called by a scheduler that
 * can only usefully log. Anything that went wrong is counted by reason so a problem
 * shows up as a number rather than as silence.
 */
export async function runDueSteps(origin: string, limit = BATCH): Promise<RunSummary> {
  const summary: RunSummary = { considered: 0, sent: 0, skipped: 0, failed: 0, reasons: {} };
  const note = (r: string) => { summary.reasons[r] = (summary.reasons[r] ?? 0) + 1; };

  if (!configured()) {
    note("no_provider");
    return summary;
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: due } = await admin
    .from("email_enrollments")
    .select("id, user_id, sequence_id, to_email, to_name, lead_key, last_step")
    .eq("status", "active")
    .not("next_run_at", "is", null)
    .lte("next_run_at", now)
    .order("next_run_at", { ascending: true })
    .limit(limit);

  const rows = (due ?? []) as Due[];
  summary.considered = rows.length;
  if (rows.length === 0) return summary;

  // Group by sender so identity and suppression are each fetched once per user rather
  // than once per recipient.
  const byUser = new Map<string, Due[]>();
  for (const r of rows) {
    const list = byUser.get(r.user_id) ?? [];
    list.push(r);
    byUser.set(r.user_id, list);
  }

  for (const [userId, enrollments] of byUser) {
    const { data: ident } = await admin
      .from("email_identities")
      .select("from_email, from_name, postal_address, verified")
      .eq("user_id", userId)
      .maybeSingle();

    if (!ident || !ident.verified) {
      // Pause rather than fail: the customer can verify their domain and the queue
      // picks up where it left off.
      summary.skipped += enrollments.length;
      note("identity_unverified");
      continue;
    }

    const identity: Identity = {
      fromEmail: ident.from_email as string,
      fromName: ident.from_name as string,
      postalAddress: ident.postal_address as string,
    };

    const suppressed = await suppressedAmong(userId, enrollments.map((e) => e.to_email));

    for (const enr of enrollments) {
      // Suppression is checked here, in the same tick as the send.
      if (suppressed.has(enr.to_email.toLowerCase())) {
        await admin
          .from("email_enrollments")
          .update({ status: "unsubscribed", next_run_at: null, updated_at: new Date().toISOString() })
          .eq("id", enr.id);
        summary.skipped++;
        note("suppressed");
        continue;
      }

      const nextPosition = enr.last_step + 1;
      const { data: step } = await admin
        .from("email_steps")
        .select("id, position, subject, body")
        .eq("sequence_id", enr.sequence_id)
        .eq("position", nextPosition)
        .maybeSingle();

      if (!step) {
        // No further steps: the sequence is finished for this lead.
        await admin
          .from("email_enrollments")
          .update({ status: "finished", next_run_at: null, updated_at: new Date().toISOString() })
          .eq("id", enr.id);
        summary.skipped++;
        note("sequence_finished");
        continue;
      }

      const recipient: Recipient = {
        email: enr.to_email,
        business: enr.to_name,
        ownerFirstName: enr.to_name,
      };
      const url = unsubscribeUrl(enr.id, origin);
      const message = compose(
        { subject: step.subject as string, body: step.body as string },
        recipient,
        identity,
        url
      );

      const blockers = sendBlockers({
        identityVerified: true,
        suppressed: false,
        toEmail: enr.to_email,
        subject: message.subject,
        body: message.text,
      });
      if (blockers.length) {
        await admin
          .from("email_enrollments")
          .update({ status: "stopped", next_run_at: null, updated_at: new Date().toISOString() })
          .eq("id", enr.id);
        summary.skipped++;
        note("blocked");
        continue;
      }

      // Claim the send BEFORE calling the provider. Two overlapping runs collide on the
      // unique index here, and the loser skips rather than sending a second copy.
      const { error: claimError } = await admin.from("email_messages").insert({
        user_id: userId,
        enrollment_id: enr.id,
        step_position: nextPosition,
        to_email: enr.to_email,
        subject: message.subject,
        status: "queued",
      });
      if (claimError) {
        summary.skipped++;
        note(claimError.code === "23505" ? "already_sent" : "claim_failed");
        continue;
      }

      const result = await providerSend({
        fromEmail: identity.fromEmail,
        fromName: identity.fromName,
        to: enr.to_email,
        subject: message.subject,
        html: message.html,
        text: message.text,
        replyTo: identity.fromEmail,
        unsubscribeUrl: url,
      });

      if (result.ok) {
        await admin
          .from("email_messages")
          .update({ status: "sent", provider_id: result.providerId, sent_at: new Date().toISOString() })
          .eq("enrollment_id", enr.id)
          .eq("step_position", nextPosition);

        const { data: next } = await admin
          .from("email_steps")
          .select("delay_days")
          .eq("sequence_id", enr.sequence_id)
          .eq("position", nextPosition + 1)
          .maybeSingle();

        await admin
          .from("email_enrollments")
          .update({
            last_step: nextPosition,
            status: next ? "active" : "finished",
            next_run_at: next
              ? new Date(Date.now() + Number(next.delay_days ?? 0) * 86_400_000).toISOString()
              : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", enr.id);

        summary.sent++;
      } else {
        await admin
          .from("email_messages")
          .update({ status: "failed", error: result.error.slice(0, 500) })
          .eq("enrollment_id", enr.id)
          .eq("step_position", nextPosition);

        if (result.retryable) {
          // Leave the enrollment due and delete the claim, so the next tick tries again.
          await admin
            .from("email_messages")
            .delete()
            .eq("enrollment_id", enr.id)
            .eq("step_position", nextPosition);
          note("retryable_failure");
        } else {
          // Permanent. Stop rather than hammering an address the provider refuses.
          await admin
            .from("email_enrollments")
            .update({ status: "stopped", next_run_at: null, updated_at: new Date().toISOString() })
            .eq("id", enr.id);
          note("permanent_failure");
        }
        summary.failed++;
      }
    }
  }

  return summary;
}

/**
 * Handle a bounce or complaint from the provider.
 *
 * Both write straight to the suppression list. A hard bounce means the address does not
 * exist and continuing to mail it damages the sender's reputation; a complaint means
 * someone pressed the spam button, which is the strongest signal there is to stop.
 */
export async function handleDeliveryEvent(
  providerId: string,
  type: "bounced" | "complained" | "delivered"
): Promise<void> {
  const admin = createAdminClient();
  const { data: msg } = await admin
    .from("email_messages")
    .select("id, user_id, to_email, enrollment_id")
    .eq("provider_id", providerId)
    .maybeSingle();
  if (!msg) return;

  await admin.from("email_messages").update({ status: type }).eq("id", msg.id);
  if (type === "delivered") return;

  await suppress(msg.user_id as string, msg.to_email as string, type);
  await admin
    .from("email_enrollments")
    .update({
      status: type === "complained" ? "unsubscribed" : "bounced",
      next_run_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", msg.enrollment_id as string);
}
