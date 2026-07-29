import { createAdminClient } from "../supabase/admin";
import { verifyContact } from "./contact";
import type { Lead } from "../types";

// Run the paid verification once per lead, ever, and write the verdict back.
//
// Both paying paths need this — unlocking one lead and exporting a batch — and both
// need it to be idempotent, because `contactVerifiedAt` is the only thing standing
// between us and paying Twilio again every time someone re-opens a lead they own.

/**
 * Bring `lead` up to paid-verified, if it isn't already, and persist the result.
 * Mutates `lead`. Returns true if a paid lookup was actually performed.
 *
 * A failed write is logged and swallowed: it costs us one repeated lookup later, which
 * is not worth failing a paid action over.
 */
export async function verifyAndPersist(lead: Lead, leadRowId: string): Promise<boolean> {
  if (lead.contactVerifiedAt) return false;

  await verifyContact(lead, "paid");

  const admin = createAdminClient();
  const { error } = await admin
    .from("leads")
    .update({
      phone_normalized: lead.phoneE164 || null,
      phone_type: lead.phoneType,
      phone_valid: lead.phoneValid,
      email_verified_status: lead.emailStatus,
      active_status: lead.activeStatus,
      deliverable: lead.deliverable,
      verification_status: lead.deliverable ? "verified" : "unverifiable",
      verified_at: lead.contactVerifiedAt,
      raw: lead as unknown as Record<string, unknown>,
    })
    .eq("id", leadRowId);
  if (error) console.error("[verify] could not persist verification:", error.message);
  return true;
}
