import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecurityGate } from "./SecurityGate";

export const metadata: Metadata = { title: "Protect your account", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Enrolment. Every account passes through here once, right after signing up.
export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const next = params.next && params.next.startsWith("/") ? params.next : "/dashboard";

  return (
    <div className="susp">
      <SecurityGate next={next} />
    </div>
  );
}
