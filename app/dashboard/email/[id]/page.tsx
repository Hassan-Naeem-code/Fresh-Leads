import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Mail, ChevronRight } from "../../../icons";
import { SequenceEditor } from "./SequenceEditor";

export const metadata: Metadata = { title: "Sequence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SequencePage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/email");
  const { id } = await params;

  const admin = createAdminClient();
  const { data: sequence } = await admin
    .from("email_sequences")
    .select("id, name, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!sequence) notFound();

  const [{ data: steps }, { data: enrollments }] = await Promise.all([
    admin.from("email_steps").select("id, position, delay_days, subject, body")
      .eq("sequence_id", id).order("position"),
    admin.from("email_enrollments")
      .select("id, to_email, to_name, status, last_step, next_run_at")
      .eq("sequence_id", id).order("created_at", { ascending: false }).limit(200),
  ]);

  return (
    <div className="wrap">
      <div className="app-head">
        <span className="app-eyebrow">
          <Link href="/dashboard/email" style={{ color: "inherit", textDecoration: "none" }}>
            <Mail size={13} /> Email
          </Link>
          <ChevronRight size={12} /> {sequence.name}
        </span>
        <h1>{sequence.name}</h1>
      </div>
      <SequenceEditor
        sequence={sequence as { id: string; name: string; status: string }}
        initialSteps={(steps ?? []) as never[]}
        initialEnrollments={(enrollments ?? []) as never[]}
      />
    </div>
  );
}
