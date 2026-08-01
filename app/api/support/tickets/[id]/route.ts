import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getTicket, replyToTicket, closeTicket } from "@/lib/support";
import { notifyOperatorOfTicket } from "@/lib/email/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Reply = z.object({ body: z.string().trim().min(1).max(8000) });

async function me() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await me();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;

  const thread = await getTicket(user.id, id);
  // Not found and not yours are answered identically on purpose: a different answer
  // for each would confirm which ticket ids exist.
  if (!thread) return NextResponse.json({ error: "No such ticket" }, { status: 404 });
  return NextResponse.json(thread);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await me();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;

  const parsed = Reply.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Write something first." }, { status: 400 });

  const ok = await replyToTicket(user.id, id, parsed.data.body);
  if (!ok) return NextResponse.json({ error: "Could not add that reply." }, { status: 400 });

  const thread = await getTicket(user.id, id);
  if (thread) {
    void notifyOperatorOfTicket({
      subject: thread.ticket.subject,
      topic: thread.ticket.topic,
      body: parsed.data.body,
      fromEmail: user.email ?? "unknown",
      ticketId: id,
      isReply: true,
    });
  }
  return NextResponse.json(thread);
}

/** Closing your own ticket. There is nothing else to patch, so the body is ignored. */
export async function PATCH(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await me();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;

  const ok = await closeTicket(user.id, id);
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "Could not close that ticket." }, { status: 400 });
}
