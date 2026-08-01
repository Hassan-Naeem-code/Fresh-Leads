import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { authorizeUrl, hubspotConfigured, saveToken, checkToken } from "@/lib/crm/hubspot";
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

/**
 * Connect with a private app token instead of OAuth.
 *
 * The token is checked against HubSpot before it is stored, so a typo is reported here
 * rather than silently failing on the first push.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) return NextResponse.json({ error: "Paste your private app token." }, { status: 400 });

  const { ok, label } = await checkToken(token);
  if (!ok) {
    return NextResponse.json(
      {
        error:
          "HubSpot did not accept that token. Check it was copied in full, and that the " +
          "private app has the companies read and write scopes.",
      },
      { status: 400 }
    );
  }

  const saved = await saveToken(user.id, token);
  return saved
    ? NextResponse.json({ ok: true, account: label })
    : NextResponse.json({ error: "Could not store that token." }, { status: 500 });
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
