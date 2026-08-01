import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { authorizeUrl, salesforceConfigured } from "@/lib/crm/salesforce";
import { deleteConnection } from "@/lib/crm/store";
import { toolsGate } from "@/lib/tools-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/dashboard/crm", req.url));
  const gate = await toolsGate(user.id);
  if (gate) return NextResponse.redirect(new URL("/dashboard/billing?locked=crm", req.url));

  if (!salesforceConfigured()) {
    return NextResponse.redirect(new URL("/dashboard/crm?error=not_configured", req.url));
  }

  const state = randomBytes(16).toString("base64url");
  const origin = new URL(req.url).origin;
  const res = NextResponse.redirect(authorizeUrl(origin, state));
  res.cookies.set("fl_sf_state", state, {
    httpOnly: true,
    secure: origin.startsWith("https"),
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const ok = await deleteConnection(user.id, "salesforce");
  return ok ? NextResponse.json({ ok: true })
            : NextResponse.json({ error: "Could not disconnect." }, { status: 500 });
}
