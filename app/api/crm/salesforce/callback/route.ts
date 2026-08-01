import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeCode } from "@/lib/crm/salesforce";
import { saveConnection } from "@/lib/crm/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const done = (params: string) => NextResponse.redirect(new URL(`/dashboard/crm?${params}`, req.url));

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/dashboard/crm", req.url));

  if (url.searchParams.get("error")) return done("error=declined");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = req.cookies.get("fl_sf_state")?.value;
  if (!code || !state || !expected || state !== expected) return done("error=bad_state");

  const tokens = await exchangeCode(url.origin, code);
  if (!tokens || !tokens.instance_url) return done("error=exchange_failed");

  // The org's own hostname doubles as the label: it is what a customer recognises,
  // and it is the thing that has to be right for any call to work.
  const label = tokens.instance_url.replace(/^https?:\/\//, "");
  const saved = await saveConnection(user.id, "salesforce", {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresIn: null,
    accountLabel: label,
    instanceUrl: tokens.instance_url,
  });

  const res = done(saved ? "connected=salesforce" : "error=save_failed");
  res.cookies.delete("fl_sf_state");
  return res;
}
