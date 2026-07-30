import Anthropic from "@anthropic-ai/sdk";
import { PLAYBOOKS, DEFAULT_PLAYBOOK, type PlaybookId } from "./playbooks";

// "Describe your ideal customer profile" → the structured fields the search actually
// needs. This is the OpenMart-style front door onto the playbook model: the parser
// fills exactly the fields the picker sets, so both paths converge on one shape and
// neither is a special case downstream.
//
// Two tiers, deliberately:
//   1. Claude, when ANTHROPIC_API_KEY is set: handles real sentences.
//   2. A deterministic keyword parser otherwise: no key, no cost, still useful.
// The fallback matters: without it, the box would simply not work until someone
// configures billing, and a half-working input is worse than a plain form.

export type ParsedIcp = {
  playbook: PlaybookId;
  /** What they sell, in their words. */
  sells: string;
  /** Business types to target. */
  targets: string[];
  /** Location to search. */
  location: string;
  /** A niche string ready to drop into the search box. */
  niche: string;
  /** True when Claude parsed it; false when the keyword fallback did. */
  ai: boolean;
  /** Anything the parser could not determine, so the UI can ask. */
  missing: string[];
};

/**
 * The Claude key. Accepts either name: the Anthropic SDK reads ANTHROPIC_API_KEY by
 * default, but CLAUDE_API_KEY is the obvious thing to call it and is what this project's
 * env actually uses. Reading only one of the two meant a key that was present and
 * correct was silently ignored, and the box quietly fell back to keyword matching with
 * no indication anything was wrong.
 */
const apiKey = () => process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "";

export const icpConfigured = () => Boolean(apiKey());

const SCHEMA = {
  type: "object" as const,
  properties: {
    playbook: {
      type: "string",
      enum: PLAYBOOKS.map((p) => p.id),
      description:
        "Which of our playbooks matches what this person SELLS. payments_pos for card processing, " +
        "terminals or POS. web_design for websites. marketing_seo for SEO, ads, content or reputation. " +
        "booking_software for scheduling, ordering or business software. general_smb for anything else " +
        "(insurance, supplies, staffing, finance) where the business type matters more than its tech.",
    },
    sells: { type: "string", description: "What they sell, one short phrase." },
    targets: {
      type: "array",
      items: { type: "string" },
      description: "Business types they want to reach, e.g. ['restaurants','cafes'].",
    },
    location: {
      type: "string",
      description: "City/area to search, e.g. 'Warren, MI'. Empty string if not stated.",
    },
    missing: {
      type: "array",
      items: { type: "string", enum: ["sells", "targets", "location"] },
      description: "Fields the description genuinely did not state. Do not guess these.",
    },
  },
  required: ["playbook", "sells", "targets", "location", "missing"],
  additionalProperties: false,
};

const SYSTEM = `You turn a salesperson's description of their ideal customer into search fields for a local-business lead tool.

Extract only what they actually said. If they did not state a location, leave it empty and list "location" in missing, never invent a city. The playbook is about what THEY SELL, not about the businesses they are targeting: someone selling card terminals to restaurants is payments_pos, not general_smb.`;

/** Claude-backed parse. Returns null if unavailable or if the call fails. */
async function parseWithClaude(description: string): Promise<ParsedIcp | null> {
  if (!icpConfigured()) return null;
  try {
    const client = new Anthropic({ apiKey: apiKey() });
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 1024,
      system: SYSTEM,
      // Extraction, not reasoning: low effort keeps this fast and cheap, and the
      // schema does the structural work.
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: description.slice(0, 2000) }],
    });

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return null;
    const parsed = JSON.parse(text.text) as Omit<ParsedIcp, "niche" | "ai">;

    const targets = (parsed.targets ?? []).map((t) => String(t).trim()).filter(Boolean);
    return {
      playbook: (parsed.playbook as PlaybookId) ?? DEFAULT_PLAYBOOK,
      sells: parsed.sells ?? "",
      targets,
      location: parsed.location ?? "",
      niche: targets[0] ?? "",
      ai: true,
      missing: parsed.missing ?? [],
    };
  } catch (e) {
    // Never fail the request over this: fall through to the keyword parser.
    console.error("[icp] Claude parse failed, using keyword fallback:", e);
    return null;
  }
}

// --- Deterministic fallback -------------------------------------------------

/** Words that indicate what the person sells, mapped to a playbook. */
const SELL_HINTS: { playbook: PlaybookId; words: string[] }[] = [
  { playbook: "payments_pos", words: [
    "card", "credit card", "payment", "payments", "processing", "merchant", "terminal",
    "pos", "point of sale", "shift4", "stripe reseller", "square reseller", "clover", "iso" ] },
  { playbook: "web_design", words: [
    "website", "websites", "web design", "web designer", "webdesign", "landing page",
    "wordpress", "shopify build", "rebuild", "redesign" ] },
  { playbook: "marketing_seo", words: [
    "seo", "marketing", "ads", "google ads", "ppc", "adwords", "content", "social media",
    "reputation", "reviews management", "agency" ] },
  { playbook: "booking_software", words: [
    "booking", "scheduling", "appointment", "reservation", "software", "saas", "crm", "app" ] },
];

/** Common local-business nouns we can recognise without an LLM. */
const TARGET_WORDS = [
  "restaurants", "restaurant", "cafes", "cafe", "coffee shops", "bars", "pubs", "diners",
  "dentists", "dental", "doctors", "clinics", "chiropractors", "vets",
  "salons", "barbers", "spas", "nail salons", "gyms",
  "law firms", "lawyers", "attorneys", "accountants", "realtors", "real estate",
  "auto repair", "mechanics", "car washes", "dealerships",
  "plumbers", "electricians", "hvac", "roofers", "contractors", "landscapers",
  "retail shops", "retail", "convenience stores", "liquor stores", "food trucks", "bakeries",
];

/** "in Austin, TX" / "near Warren MI" / "around Tampa" */
function extractLocation(text: string): string {
  const m = text.match(
    /\b(?:in|near|around|based in|across)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)*(?:\s*,\s*[A-Z]{2})?)/
  );
  return m ? m[1].trim() : "";
}

export function parseIcpHeuristic(description: string): ParsedIcp {
  const text = description.trim();
  const lower = text.toLowerCase();

  // Score each playbook by how many of its hint words appear, longest match first so
  // "point of sale" beats a stray "sale".
  let playbook: PlaybookId = DEFAULT_PLAYBOOK;
  let best = 0;
  for (const hint of SELL_HINTS) {
    const score = hint.words.reduce((n, w) => (lower.includes(w) ? n + w.length : n), 0);
    if (score > best) {
      best = score;
      playbook = hint.playbook;
    }
  }

  const targets = [...new Set(TARGET_WORDS.filter((w) => lower.includes(w)))]
    // Prefer the most specific phrasing: drop "restaurant" if "restaurants" matched.
    .filter((w, _i, all) => !all.some((other) => other !== w && other.includes(w)))
    .slice(0, 6);

  const location = extractLocation(text);

  const missing: string[] = [];
  if (!text) missing.push("sells");
  if (targets.length === 0) missing.push("targets");
  if (!location) missing.push("location");

  return {
    playbook,
    sells: text.slice(0, 200),
    targets,
    location,
    niche: targets[0] ?? "",
    ai: false,
    missing,
  };
}

/**
 * Parse a free-text ICP description. Uses Claude when configured, and always returns
 * something usable so the box works before an API key exists.
 */
export async function parseIcp(description: string): Promise<ParsedIcp> {
  return (await parseWithClaude(description)) ?? parseIcpHeuristic(description);
}
