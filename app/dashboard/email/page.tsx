import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Mail } from "../../icons";
import { EmailHome } from "./EmailHome";

export const metadata: Metadata = { title: "Email", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function EmailPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/email");

  return (
    <div className="wrap">
      <div className="app-head">
        <span className="app-eyebrow"><Mail size={13} /> Email</span>
        <h1>Follow up automatically.</h1>
        <p>
          Write a short sequence, put opened leads into it, and it sends on its own. Every
          message carries an unsubscribe link, and anyone who opts out or bounces is never
          contacted again.
        </p>
      </div>
      <EmailHome />
    </div>
  );
}
