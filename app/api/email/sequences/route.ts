import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { toolsGate } from "@/lib/tools-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function me() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await me();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const gate = await toolsGate(user.id);
  if (gate) return gate;

  const admin = createAdminClient();
  const { data: sequences } = await admin
    .from("email_sequences")
    .select("id, name, status, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  // Counts per sequence, so the list can show progress without a query per row.
  const ids = (sequences ?? []).map((s) => s.id as string);
  const counts: Record<string, { active: number; finished: number; total: number }> = {};
  if (ids.length) {
    const { data: enr } = await admin
      .from("email_enrollments")
      .select("sequence_id, status")
      .in("sequence_id", ids)
      .limit(50_000);
    for (const e of enr ?? []) {
      const k = e.sequence_id as string;
      counts[k] ??= { active: 0, finished: 0, total: 0 };
      counts[k].total++;
      if (e.status === "active") counts[k].active++;
      if (e.status === "finished") counts[k].finished++;
    }
  }

  return NextResponse.json({
    sequences: (sequences ?? []).map((s) => ({
      ...s,
      counts: counts[s.id as string] ?? { active: 0, finished: 0, total: 0 },
    })),
  });
}

export async function POST(req: Request) {
  const user = await me();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const gate = await toolsGate(user.id);
  if (gate) return gate;

  const parsed = z.object({ name: z.string().trim().min(1).max(80) })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give the sequence a name." }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_sequences")
    .insert({ user_id: user.id, name: parsed.data.name })
    .select("id, name, status, created_at")
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Could not create that." }, { status: 500 });

  // A sequence with no steps can do nothing, so it starts with one ready to edit.
  await admin.from("email_steps").insert({
    sequence_id: data.id,
    position: 1,
    delay_days: 0,
    subject: "A quick question about {{business}}",
    body: "Hi,\n\nI noticed {{business}} and thought I would reach out.\n\n",
  });

  return NextResponse.json({ sequence: data });
}
