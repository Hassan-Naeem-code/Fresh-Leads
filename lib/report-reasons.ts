// Why a lead was wrong. CLIENT-SAFE, with no server imports, exactly like
// lib/pricing.ts: the report control in the dashboard is a client component and
// importing this from lib/credits.ts would drag the service-role Supabase client
// (and node:crypto) into the browser bundle.
//
// The list is CLOSED and mirrors the CHECK constraint in migration 031. Free text
// cannot be counted, and counting these is the entire point: they are the only ground
// truth we have about our own accuracy, and lib/quality.ts aggregates them into the
// numbers we are willing to publish.

export const REPORT_REASONS = [
  { id: "wrong_number", label: "Wrong number", blurb: "It rings, but it isn't this business." },
  { id: "dead_number", label: "Number is dead", blurb: "Disconnected or never answers." },
  { id: "closed", label: "They've closed", blurb: "Out of business, or gone for good." },
  { id: "email_bounced", label: "Email bounced", blurb: "Mail to the address came back." },
  { id: "not_owner", label: "Wrong person", blurb: "The name we gave doesn't run this business." },
  { id: "wrong_business", label: "Not what I asked for", blurb: "Real business, wrong kind." },
  { id: "duplicate", label: "Duplicate", blurb: "I'd already paid for this business." },
  { id: "other", label: "Something else", blurb: "Tell us what went wrong." },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["id"];

export const isReportReason = (v: unknown): v is ReportReason =>
  typeof v === "string" && REPORT_REASONS.some((r) => r.id === v);

/**
 * Which reasons are a failure of VERIFICATION, i.e. we said we had checked something
 * and it was wrong anyway.
 *
 * Separated from the rest because they are the ones that belong in a published
 * accuracy number. "Not what I asked for" is a relevance miss and "duplicate" is a
 * dedupe miss: both are real faults worth fixing, but neither is a claim that a
 * contact we verified turned out to be dead, and quietly folding them together would
 * make our headline number look worse than the thing it is measuring.
 */
export const VERIFICATION_REASONS: ReportReason[] = [
  "wrong_number", "dead_number", "closed", "email_bounced", "not_owner",
];
