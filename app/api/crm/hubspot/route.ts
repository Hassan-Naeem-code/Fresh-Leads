import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { authorizeUrl, hubspotConfigured } from "@/lib/crm/hubspot";
import { deleteConnection } from "@/lib/crm/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start the connect flow: send the customer to HubSpot to approve. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/dashboard/crm", req.url));

  if (!hubspotConfigured()) {
    return NextResponse.redirect(new URL("/dashboard/crm?error=not_configured", req.url));
  }

  // CSRF protection for the round trip. Kept in an httpOnly cookie and compared on the
  // way back, so a callback the customer did not start cannot connect an account.
  const state = randomBytes(16).toString("base64url");
  const origin = new URL(req.url).origin;
  const res = NextResponse.redirect(authorizeUrl(origin, state));
  res.cookies.set("fl_crm_state", state, {
    httpOnly: true,
    secure: origin.startsWith("https"),
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}

/** Disconnect. Removes our copy of the tokens. */
export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const ok = await deleteConnection(user.id, "hubspot");
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "Could not disconnect." }, { status: 500 });
}
