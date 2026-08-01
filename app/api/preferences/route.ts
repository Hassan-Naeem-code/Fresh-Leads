import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getPreferences, savePreferences } from "@/lib/preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  displayName: z.string().max(80).optional(),
  defaultResultCount: z.number().int().min(5).max(80).nullable().optional(),
  notifyProductNews: z.boolean().optional(),
  notifyWeeklyDigest: z.boolean().optional(),
});

async function me() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await me();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ preferences: await getPreferences(user.id) });
}

export async function POST(req: NextRequest) {
  const user = await me();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    return NextResponse.json({ preferences: await savePreferences(user.id, parsed.data) });
  } catch {
    return NextResponse.json({ error: "Could not save your settings." }, { status: 500 });
  }
}
