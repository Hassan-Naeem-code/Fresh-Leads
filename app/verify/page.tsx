import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listFactors } from "@/lib/mfa/store";
import { MfaChallenge } from "../MfaChallenge";

export const metadata: Metadata = { title: "Confirm it is you", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// The challenge screen. Reached by middleware whenever a password session has not yet
// proved a second factor.
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const next = params.next && params.next.startsWith("/") ? params.next : "/dashboard";

  const factors = await listFactors({ userId: user.id }, true);
  // Nothing set up yet means enrolment, not a challenge. Sending someone to a code box
  // they cannot possibly fill is the fastest way to lose them.
  if (factors.length === 0) redirect(`/two-factor?next=${encodeURIComponent(next)}`);

  return (
    <div className="susp">
      <MfaChallenge
        who={user.email ?? ""}
        next={next}
        factors={factors.map((f) => ({ id: f.id, kind: f.kind, label: f.label, phone: f.phone }))}
      />
    </div>
  );
}
