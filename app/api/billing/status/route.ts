import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccess } from "@/lib/access";

export const runtime = "nodejs";

// The caller's current balance and access. Used right after returning from Stripe:
// the webhook that actually grants the purchase can land a moment after the browser
// redirect, so the dashboard polls this briefly rather than showing a stale balance
// and making the customer wonder where their money went.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const access = await getAccess(user.id);
  return NextResponse.json({
    credits: access.credits,
    subscribed: access.subscribed,
    canBuyCredits: access.canBuyCredits,
  });
}
