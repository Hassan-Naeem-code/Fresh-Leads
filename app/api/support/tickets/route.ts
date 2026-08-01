import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { listTickets, createTicket, TICKET_TOPICS, type TicketTopic } from "@/lib/support";
import { notifyOperatorOfTicket } from "@/lib/email/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Support is NOT behind the subscription. Someone who cannot get the product to work
// is exactly the person who needs to reach us, and putting a paywall in front of
// "help" is how a small problem becomes a refund.

const TOPIC_IDS = TICKET_TOPICS.map((t) => t.id) as [TicketTopic, ...TicketTopic[]];

const Body = z.object({
  subject: z.string().trim().min(3).max(140),
  topic: z.enum(TOPIC_IDS),
  body: z.string().trim().min(1).max(8000),
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
  return NextResponse.json({ tickets: await listTickets(user.id) });
}

export async function POST(req: NextRequest) {
  const user = await me();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A subject and a description are both needed." },
      { status: 400 }
    );
  }

  const result = await createTicket(user.id, parsed.data);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

  // Fire and forget. A ticket that saved but could not be emailed about is far better
  // than one refused because the mail provider was down, so this is never awaited into
  // the response and never fails the request.
  void notifyOperatorOfTicket({
    subject: parsed.data.subject,
    topic: parsed.data.topic,
    body: parsed.data.body,
    fromEmail: user.email ?? "unknown",
    ticketId: result.ticket.id,
  });

  return NextResponse.json({ ticket: result.ticket });
}
