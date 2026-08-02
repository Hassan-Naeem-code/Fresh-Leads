// The public API reference, as data.
//
// Kept apart from the page so the shapes can be checked by a test: an example that
// drifts from the real handler is worse than no documentation, because somebody will
// build against it and blame us when it fails.

export type Endpoint = {
  id: string;
  method: "POST" | "GET" | "DELETE";
  path: string;
  title: string;
  summary: string;
  cost: string;
  body?: Record<string, string>;
  response: string;
  notes?: string[];
};

export const BASE_URL = "https://www.fresh-leads.io";

export const ENDPOINTS: Endpoint[] = [
  {
    id: "search",
    method: "POST",
    path: "/api/v1/leads",
    title: "Search for leads",
    summary:
      "Find local businesses matching a trade and an area. Returns leads locked, exactly as the dashboard shows them: who and where, the grade, and whether we verified a way to reach them.",
    cost: "Free. You need at least one credit in your balance to search, but searching never spends one.",
    body: {
      niche: "string, required. The trade, e.g. \"dentists\".",
      location: "string, required. Town, city or postcode, e.g. \"Austin, TX\".",
      limit: "number, 1 to 80. Defaults to 40.",
      playbook:
        "string. What you sell, which decides how leads are graded: web_design, payments_pos, marketing_seo, booking_software, general_smb.",
      minRating: "number, 1 to 5. Skip businesses rated below this.",
      minReviews: "number. Skip businesses with fewer reviews than this.",
      webPresence: "string: any, has_site, social_only or none.",
    },
    response: "{ leads: LockedLead[], notes: string[] }",
    notes: [
      "A locked lead carries no phone, email or address. Those are what a credit buys.",
      "Every lead is checked live at the moment you search, not read from a cache.",
    ],
  },
  {
    id: "unlock",
    method: "POST",
    path: "/api/leads/unlock",
    title: "Open a lead",
    summary:
      "Spend one credit to reveal a lead in full: verified phone, verified email, address, the grade breakdown and what to pitch.",
    cost: "One credit. Charged once per business, forever. Opening the same lead again is free.",
    body: { leadId: "string, required. The id from a search result." },
    response: "{ lead: Lead, creditsLeft: number }",
    notes: [
      "The charge happens inside one database function, so two calls at once cannot spend two credits on the same business.",
      "If the phone and mailbox both turn out to be dead, you are not charged at all.",
    ],
  },
  {
    id: "owner",
    method: "POST",
    path: "/api/leads/owner",
    title: "Reveal the owner",
    summary:
      "The person who runs the business, where we can find one: name, role, and a personal email or profile if it exists.",
    cost: "One credit, once, permanently.",
    body: { leadId: "string, required. Must already be open." },
    response: "{ owner: Owner | null, creditsLeft: number }",
    notes: [
      "The lead has to be open first: selling the owner of a business you cannot otherwise see would be selling a fragment.",
      "Roughly a third of small businesses name an owner anywhere we can read. When we are not confident, we return null rather than a guess.",
    ],
  },
  {
    id: "export",
    method: "POST",
    path: "/api/leads/export",
    title: "Export",
    summary:
      "Take leads out as a spreadsheet, a JSON payload, a printable call sheet, or under the column names HubSpot and Salesforce expect.",
    cost: "Free for leads you have already opened. One credit each for any that are still locked.",
    body: {
      leadIds: "string[], 1 to 1000 ids.",
      format: "string: csv, json, pdf, hubspot or salesforce. Defaults to csv.",
    },
    response: "A file, with the matching content type.",
  },
  {
    id: "enrich",
    method: "POST",
    path: "/api/enrich",
    title: "Enrich your own list",
    summary:
      "Send a CSV of businesses you already have and get it back with the gaps filled: verified phone and email, the owner where findable, and what we know about their website.",
    cost: "One credit per row we actually enrich. A row we cannot identify comes back untouched and costs nothing.",
    body: { file: "multipart/form-data, up to 500 rows." },
    response: "A CSV with our columns appended, plus fl_status on every row.",
  },
];

export const ERRORS: { code: string; status: number; meaning: string }[] = [
  { code: "401", status: 401, meaning: "No key, or a key that has been revoked." },
  { code: "402 subscription_required", status: 402, meaning: "The account needs the yearly plan." },
  { code: "402 insufficient_credits", status: 402, meaning: "Not enough credits for that call." },
  { code: "429 rate_limited", status: 429, meaning: "Too many calls. Retry-After says how long to wait." },
  { code: "400", status: 400, meaning: "The body did not match the shape above." },
  { code: "500", status: 500, meaning: "Our fault. Safe to retry: every paid action is idempotent." },
];
