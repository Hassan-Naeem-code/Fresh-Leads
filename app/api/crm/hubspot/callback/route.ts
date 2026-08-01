import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeCode, accountLabel } from "@/lib/crm/hubspot";
import { saveConnection } from "@/lib/crm/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Where HubSpot sends the customer back. Everything here can fail for ordinary
// reasons (they pressed cancel, the code expired), so every path ends on the settings
// page with something readable rather than a stack trace.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const done = (params: string) => NextResponse.redirect(new URL(`/dashboard/crm?${params}`, req.url));

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/dashboard/crm", req.url));

  if (url.searchParams.get("error")) return done("error=declined");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = req.cookies.get("fl_crm_state")?.value;

  // The state has to match the one we set when the flow started.
  if (!code || !state || !expected || state !== expected) return done("error=bad_state");

  const tokens = await exchangeCode(url.origin, code);
  if (!tokens) return done("error=exchange_failed");

  const label = await accountLabel(tokens.access_token);
  const saved = await saveConnection(user.id, "hubspot", {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresIn: tokens.expires_in ?? null,
    accountLabel: label,
  });

  const res = done(saved ? "connected=1" : "error=save_failed");
  res.cookies.delete("fl_crm_state");
  return res;
}
