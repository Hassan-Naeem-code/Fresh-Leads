import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccess } from "@/lib/access";

export const runtime = "nodejs";

// The caller's current balance and access. Used right after returning from Stripe:
// the webhook that actually grants the purchase can land a moment after the browser
// redirect, so the dashboard polls this briefly rather than showing a stale balance
// and making the customer wonder where their money went.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const access = await getAccess(user.id);

  // DID THIS PARTICULAR PURCHASE LAND?
  //
  // Comparing the balance against a baseline does not answer that. The baseline can
  // only be taken once the browser is back from Stripe, and the webhook now lands in
  // about two seconds, so a fast grant is already included in the "before" figure and
  // the purchase looks like it never arrived. A real customer was told their payment
  // had not been applied while their new credits sat in the header.
  //
  // The checkout session id is the exact question. It is the ledger's idempotency key
  // for a purchase, so its presence is proof, not an inference.
  const session = request.nextUrl.searchParams.get("session");
  let applied: boolean | null = null;
  if (session) {
    const { data } = await createAdminClient()
      .from("credit_ledger")
      .select("id")
      .eq("user_id", user.id)
      .eq("ref", session)
      .limit(1);
    applied = (data?.length ?? 0) > 0;
  }

  return NextResponse.json({
    credits: access.credits,
    subscribed: access.subscribed,
    canBuyCredits: access.canBuyCredits,
    applied,
  });
}
