import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function me() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/** Every read and write is scoped to the owner, so a guessed id reaches nothing. */
async function ownedSequence(userId: string, id: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("email_sequences")
    .select("id, name, status, created_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await me();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;

  const sequence = await ownedSequence(user.id, id);
  if (!sequence) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = createAdminClient();
  const [{ data: steps }, { data: enrollments }] = await Promise.all([
    admin.from("email_steps").select("id, position, delay_days, subject, body")
      .eq("sequence_id", id).order("position"),
    admin.from("email_enrollments")
      .select("id, to_email, to_name, status, last_step, next_run_at")
      .eq("sequence_id", id).order("created_at", { ascending: false }).limit(200),
  ]);

  return NextResponse.json({ sequence, steps: steps ?? [], enrollments: enrollments ?? [] });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await me();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  if (!(await ownedSequence(user.id, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = z.object({
    name: z.string().trim().min(1).max(80).optional(),
    status: z.enum(["draft", "active", "paused"]).optional(),
  }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const admin = createAdminClient();

  // Activating a sequence with no steps would enrol people into nothing.
  if (parsed.data.status === "active") {
    const { count } = await admin.from("email_steps")
      .select("id", { count: "exact", head: true }).eq("sequence_id", id);
    if (!count) {
      return NextResponse.json({ error: "Add at least one step before starting this." }, { status: 400 });
    }
  }

  await admin.from("email_sequences")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id);

  // Pausing has to stop the queue too, or the daily run keeps sending.
  if (parsed.data.status === "paused") {
    await admin.from("email_enrollments")
      .update({ next_run_at: null }).eq("sequence_id", id).eq("status", "active");
  }
  // Resuming makes everything active due at the next run rather than losing them.
  if (parsed.data.status === "active") {
    await admin.from("email_enrollments")
      .update({ next_run_at: new Date().toISOString() })
      .eq("sequence_id", id).eq("status", "active").is("next_run_at", null);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await me();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  if (!(await ownedSequence(user.id, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Steps, enrollments and messages cascade. Suppressions deliberately do NOT: an
  // unsubscribe outlives the campaign that caused it.
  const admin = createAdminClient();
  await admin.from("email_sequences").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
