import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listFactors } from "@/lib/mfa/store";
import { SecurityGate } from "./SecurityGate";

export const metadata: Metadata = {
  title: "Protect your account",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

// Two factor enrolment. Every account passes through here once, right after signing up.
//
// It lives at /two-factor rather than /security because /security is a PUBLIC
// marketing page. When both wanted the same path the marketing page won, and every
// account without a factor was redirected to a page it could not enrol from: signed
// in, sent to /security, shown a sales page, sent back. A closed loop with no way out
// of it, for every new signup.
export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const next = params.next && params.next.startsWith("/") ? params.next : "/dashboard";

  // Already protected: there is nothing to do here, so do not make them look at it.
  const factors = await listFactors({ userId: user.id }, true);
  if (factors.length > 0) redirect(`/verify?next=${encodeURIComponent(next)}`);

  return (
    <div className="susp">
      <SecurityGate next={next} />
    </div>
  );
}
