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

async function ownsSequence(userId: string, sequenceId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("email_sequences")
    .select("id").eq("id", sequenceId).eq("user_id", userId).maybeSingle();
  return Boolean(data);
}

export async function POST(req: Request) {
  const user = await me();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const gate = await toolsGate(user.id);
  if (gate) return gate;

  const parsed = z.object({ sequenceId: z.string().uuid() })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  if (!(await ownsSequence(user.id, parsed.data.sequenceId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: last } = await admin.from("email_steps")
    .select("position").eq("sequence_id", parsed.data.sequenceId)
    .order("position", { ascending: false }).limit(1).maybeSingle();
  const position = ((last?.position as number) ?? 0) + 1;

  const { data, error } = await admin.from("email_steps").insert({
    sequence_id: parsed.data.sequenceId,
    position,
    // A follow up defaults to three days, which is the usual gap and stops anyone
    // accidentally sending two emails on the same day.
    delay_days: 3,
    subject: "Following up",
    body: "Just following up on my last note.\n\n",
  }).select("id, position, delay_days, subject, body").maybeSingle();

  if (error || !data) return NextResponse.json({ error: "Could not add a step." }, { status: 500 });
  return NextResponse.json({ step: data });
}

export async function PATCH(req: Request) {
  const user = await me();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const gate = await toolsGate(user.id);
  if (gate) return gate;

  const parsed = z.object({
    id: z.string().uuid(),
    sequenceId: z.string().uuid(),
    subject: z.string().max(200).optional(),
    body: z.string().max(10_000).optional(),
    delayDays: z.number().int().min(0).max(365).optional(),
  }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  if (!(await ownsSequence(user.id, parsed.data.sequenceId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = createAdminClient();
  await admin.from("email_steps").update({
    ...(parsed.data.subject !== undefined ? { subject: parsed.data.subject } : {}),
    ...(parsed.data.body !== undefined ? { body: parsed.data.body } : {}),
    ...(parsed.data.delayDays !== undefined ? { delay_days: parsed.data.delayDays } : {}),
  }).eq("id", parsed.data.id).eq("sequence_id", parsed.data.sequenceId);

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const user = await me();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const gate = await toolsGate(user.id);
  if (gate) return gate;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const sequenceId = url.searchParams.get("sequenceId");
  if (!id || !sequenceId) return NextResponse.json({ error: "Which step?" }, { status: 400 });
  if (!(await ownsSequence(user.id, sequenceId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = createAdminClient();
  await admin.from("email_steps").delete().eq("id", id).eq("sequence_id", sequenceId);

  // Close the gap left in the numbering, or the sender looks for a step that is not
  // there and treats the sequence as finished early.
  const { data: rest } = await admin.from("email_steps")
    .select("id").eq("sequence_id", sequenceId).order("position");
  let n = 1;
  for (const s of rest ?? []) {
    await admin.from("email_steps").update({ position: n++ }).eq("id", s.id as string);
  }

  return NextResponse.json({ ok: true });
}
