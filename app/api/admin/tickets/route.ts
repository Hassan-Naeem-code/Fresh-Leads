import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/admin/guard";
import { getTicketAsAdmin, answerTicket, setTicketStatus } from "@/lib/support";
import { notifyCustomerOfReply } from "@/lib/email/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.union([
  z.object({ id: z.string().uuid(), action: z.literal("reply"), body: z.string().trim().min(1).max(8000) }),
  z.object({ id: z.string().uuid(), action: z.literal("close") }),
  z.object({ id: z.string().uuid(), action: z.literal("reopen") }),
]);

/** The thread, for the operator. */
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Which ticket?" }, { status: 400 });

  const thread = await getTicketAsAdmin(id);
  if (!thread) return NextResponse.json({ error: "No such ticket" }, { status: 404 });
  return NextResponse.json(thread);
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const input = parsed.data;

  if (input.action === "reply") {
    const ok = await answerTicket(input.id, input.body);
    if (!ok) return NextResponse.json({ error: "Could not send that reply." }, { status: 400 });

    const thread = await getTicketAsAdmin(input.id);
    if (thread?.ticket.email) {
      void notifyCustomerOfReply({
        to: thread.ticket.email,
        subject: thread.ticket.subject,
        ticketId: input.id,
      });
    }
    return NextResponse.json(thread);
  }

  const ok = await setTicketStatus(input.id, input.action === "close" ? "closed" : "open");
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "Could not change that." }, { status: 400 });
}
