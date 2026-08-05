import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { JoinPanel } from "./JoinPanel";

export const metadata: Metadata = { title: "Join a team", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Where an invite link lands.
//
// Signing in comes FIRST, always. An invite is redeemed against the signed-in identity
// and the address it was sent to must match, because a link that joined whoever opened
// it would let one forwarded email attach a stranger to somebody's shared credit
// balance. The token is carried through the sign in rather than redeemed before it, so
// nothing is joined to an account nobody has proved they own.
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const token = (params.token ?? "").trim();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/join?token=${encodeURIComponent(token)}`)}`);
  }

  return (
    <div className="susp">
      <JoinPanel token={token} email={user.email ?? ""} />
    </div>
  );
}
