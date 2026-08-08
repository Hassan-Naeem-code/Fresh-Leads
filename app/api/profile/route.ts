import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getBuyerProfile, saveBuyerProfile } from "@/lib/buyer-profile";
import { parseIcp, icpConfigured } from "@/lib/icp-parse";
import { PLAYBOOKS, type PlaybookId } from "@/lib/playbooks";

export const runtime = "nodejs";

const PLAYBOOK_IDS = PLAYBOOKS.map((p) => p.id) as [PlaybookId, ...PlaybookId[]];

const Body = z.object({
  playbook: z.enum(PLAYBOOK_IDS).optional(),
  sells: z.string().max(500).optional(),
  targets: z.array(z.string().max(80)).max(12).optional(),
  location: z.string().max(160).optional(),
  // Accepted so the dashboard can CLEAR them. An empty array is a real instruction
  // here, distinct from omitting the field, which leaves what is stored untouched.
  criteria: z.array(z.string().max(200)).max(12).optional(),
  excludes: z.array(z.string().max(200)).max(12).optional(),
  /** Free-text "describe your ideal customer", parsed into the fields above. */
  describe: z.string().max(2000).optional(),
});

/** What the user sells, so the dashboard can restore it after a reload. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  return NextResponse.json({ profile: await getBuyerProfile(user.id), aiParsing: icpConfigured() });
}

/**
 * Save the buyer profile. Accepts either explicit fields (the playbook picker) or a
 * free-text `describe` string, which is parsed into the same fields, so the
 * natural-language box and the picker write identical state.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    if (parsed.data.describe) {
      const icp = await parseIcp(parsed.data.describe);
      const profile = await saveBuyerProfile(user.id, {
        playbook: icp.playbook,
        sells: icp.sells,
        targets: icp.targets,
        location: icp.location,
        // Persisted alongside the rest, so a reload does not silently widen the next
        // search back to the whole category (migration 034).
        criteria: icp.criteria,
        excludes: icp.excludes,
      });
      // `parsed` tells the UI what to prefill; `missing` tells it what to still ask.
      return NextResponse.json({ profile, parsed: icp });
    }

    const profile = await saveBuyerProfile(user.id, parsed.data);
    return NextResponse.json({ profile });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[profile]", msg);
    return NextResponse.json({ error: "Could not save your profile." }, { status: 500 });
  }
}
