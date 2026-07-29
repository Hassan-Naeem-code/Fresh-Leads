import { verifyPhone } from "./phone";
import { verifyEmail } from "./email";
import { assessActive } from "./active";
import type { Lead } from "../types";

// Verifying a lead's contact channels, at two price points.
//
// WHY THIS IS SPLIT IN TWO
// ------------------------
// Cost is incurred per lead DISCOVERED; revenue arrives per lead UNLOCKED. A search
// discovers ~40 leads and a typical user opens a handful, so paying Twilio and
// ZeroBounce for all 40 up front meant ~90% of the verification bill bought nothing.
// Measured: 11.7c per lead sold, against 2.8c when the paid lookups wait for the
// unlock. At $1 a lead that waste was invisible; at 20c it was most of the margin.
//
// Nothing is lost by waiting, because a locked lead never shows its phone or email in
// the first place — there is no verified contact detail on screen to be stale.
//
// The two tiers must agree on what "deliverable" means, which is the whole reason this
// lives in one function rather than being written out at each call site.

export type ContactTier = "free" | "paid";

/**
 * Fill in a lead's phone/email verification fields and set the `deliverable` gate.
 * Mutates `lead` in place (it is a throwaway object built per request) and returns it.
 *
 * - `free`: offline only — libphonenumber format check, email syntax + MX. Costs nothing.
 * - `paid`: adds Twilio Lookup (is the line actually live?) and ZeroBounce (is the
 *   mailbox actually there?). Roughly 2.1c per lead with both channels present.
 */
export async function verifyContact(lead: Lead, tier: ContactTier): Promise<Lead> {
  const paid = tier === "paid";

  let phoneReachable: boolean | null = null;
  if (lead.phone) {
    const pv = await verifyPhone(lead.phone, "US", { paid });
    lead.phoneValid = pv.valid;
    lead.phoneType = pv.type;
    lead.phoneE164 = pv.e164;
    phoneReachable = pv.reachable; // non-null only once Twilio has confirmed the line
  }

  if (lead.email) {
    lead.emailStatus = (await verifyEmail(lead.email, { paid })).status;
  }

  lead.activeStatus = assessActive({
    businessStatus: lead.businessStatus,
    hasWebsite: lead.hasWebsite,
    siteReachable: lead.siteReachable,
    freshness: lead.freshness,
  });

  // Genuine + reachable: a usable phone OR a plausible email, and not closed. When
  // Twilio actually confirmed the line, trust it over the offline format check — a
  // well-formed number that no longer rings is exactly the case the paid tier exists
  // to catch, and the free tier cannot tell the difference.
  const phoneUsable = phoneReachable !== null ? phoneReachable : lead.phoneValid === true;
  const reachable =
    phoneUsable || lead.emailStatus === "deliverable" || lead.emailStatus === "risky";

  lead.deliverable = reachable && lead.activeStatus !== "likely_closed";
  if (paid) lead.contactVerifiedAt = new Date().toISOString();
  return lead;
}
