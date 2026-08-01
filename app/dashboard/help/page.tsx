import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listTickets } from "@/lib/support";
import { FAQ, FAQ_TOPICS } from "@/lib/faq";
import { LifeBuoy } from "../../icons";
import { HelpCenter } from "./HelpCenter";

export const metadata: Metadata = { title: "Help", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Help is open to everybody signed in, subscribed or not. Someone who cannot make the
// product work is the last person who should meet a paywall.
export default async function HelpPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/help");

  const tickets = await listTickets(user.id);

  return (
    <div className="wrap">
      <div className="app-head">
        <span className="app-eyebrow">
          <LifeBuoy size={13} /> Help
        </span>
        <h1>Answers, and a way to reach us.</h1>
        <p>
          Most questions are answered below. If yours is not, open a ticket and a person will
          read it. We answer in your account, so the reply is here waiting for you.
        </p>
      </div>

      <HelpCenter faq={FAQ} topics={FAQ_TOPICS} initialTickets={tickets} />
    </div>
  );
}
