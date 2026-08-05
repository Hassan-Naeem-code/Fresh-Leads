import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccess } from "@/lib/access";
import { getCreditBalance } from "@/lib/credits";
import { membershipOf, membersOf } from "@/lib/org";
import { Users } from "../../icons";
import { TeamPanel } from "./TeamPanel";

export const metadata: Metadata = { title: "Your team", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// The team screen.
//
// Deliberately reachable without a subscription. Somebody comparing this product for a
// team of five needs to see how the seats and the shared balance work BEFORE paying,
// and a locked page that says "subscribe to find out" answers the wrong question.
export default async function TeamPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/team");

  const [membership, access] = await Promise.all([membershipOf(user.id), getAccess(user.id)]);
  const members = membership ? await membersOf(membership.orgId) : [];
  // The shared figure, resolved through the billing owner exactly as a spend would be,
  // so the number on this page is the number a colleague is about to spend.
  const credits = await getCreditBalance(user.id);

  return (
    <div className="wrap">
      <div className="app-head">
        <span className="app-eyebrow"><Users size={13} /> Your team</span>
        <h1>Work from one balance.</h1>
        <p className="muted">
          Everyone on the team spends the same credits, shares one yearly plan, and sees
          every lead anyone has already opened. Nobody pays twice for the same business.
        </p>
      </div>

      <TeamPanel
        initial={
          membership
            ? {
                id: membership.orgId,
                name: membership.orgName,
                role: membership.role,
                youAreTheOwner: membership.ownerUserId === user.id,
                members,
                invites: [],
                // Filled properly by the client's first fetch, which is also where the
                // role check for invites lives. Seeded from the member count so the
                // first paint is not misleading.
                seats: undefined,
                seatsUsed: members.length,
              }
            : null
        }
        credits={credits}
        subscribed={access.subscribed}
      />
    </div>
  );
}
