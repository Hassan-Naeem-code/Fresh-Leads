import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getTicket } from "@/lib/support";
import { ChevronRight, LifeBuoy } from "../../../icons";
import { TicketThread } from "./TicketThread";

export const metadata: Metadata = { title: "Ticket", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/help");

  const { id } = await params;
  const thread = await getTicket(user.id, id);
  if (!thread) notFound();

  return (
    <div className="wrap">
      <div className="app-head">
        <span className="app-eyebrow">
          <Link href="/dashboard/help">
            <LifeBuoy size={13} /> Help
          </Link>
          <ChevronRight size={12} /> Ticket
        </span>
        <h1>{thread.ticket.subject}</h1>
      </div>

      <TicketThread ticket={thread.ticket} initialMessages={thread.messages} />
    </div>
  );
}
