// PUBLIC API, version 1.
//
// Deliberately a re-export rather than a second implementation. The dashboard and the
// API return the same leads because they ARE the same code: the handler resolves a
// session cookie or an API key, and everything after that (the access gate, the credit
// balance, the locked-lead allow list) is unchanged. An API caller can never see more
// than the same customer sees on screen.
export { POST } from "../../leads/route";

export const runtime = "nodejs";
export const maxDuration = 60;

/** A GET here is someone exploring, so answer with what they came for. */
export function GET() {
  return Response.json({
    endpoint: "POST /api/v1/leads",
    authentication: "Authorization: Bearer fl_live_...",
    body: {
      niche: "dentists",
      location: "Austin, TX",
      limit: 40,
      playbook: "web_design | payments_pos | marketing_seo | booking_software | general_smb",
      problem: "any",
      minRating: 4,
      minReviews: 25,
      webPresence: "any | has_site | social_only | none",
    },
    notes: [
      "Searching is free. A credit is spent only when a lead is opened.",
      "Locked leads carry no contact details, exactly as in the dashboard.",
      "Open a lead with POST /api/leads/unlock, and reveal its owner with POST /api/leads/owner.",
      "Export with POST /api/leads/export and format: csv, json, pdf, hubspot or salesforce.",
    ],
  });
}
