import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { getAccess } from "./access";

// The gate on the subscriber sections.
//
// The left rail hides these from a trial account, but hiding a link is decoration, not
// a rule: the URL is still typeable and gets shared. This runs on the server, in the
// page itself, so the rule holds wherever the request came from.
//
// It redirects rather than showing a wall, and carries which section was wanted, so
// billing can say what the fee unlocks instead of leaving someone to guess why they
// were moved.

export type LockedSection = "history" | "enrich" | "email" | "crm" | "api";

export async function requireSubscription(section: LockedSection): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Not signed in is the layout's job, and it redirects to login. Nothing to add here.
  if (!user) return;

  const access = await getAccess(user.id);
  if (!access.canUseTools) redirect(`/dashboard/billing?locked=${section}`);
}
