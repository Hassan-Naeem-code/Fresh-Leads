import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { domainVerified, configured } from "@/lib/email/provider";
import { suppressionSummary } from "@/lib/email/suppression";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The address mail is sent from, and whether it is allowed to send at all.
//
// Verification is the provider's answer, not ours, and it is re-checked on every load
// rather than trusted from the last time it was saved: a domain can fail verification
// later when a DNS record is changed, and continuing to send from it is what damages a
// sending reputation.

async function me() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

const Body = z.object({
  fromEmail: z.string().email(),
  fromName: z.string().trim().min(1).max(80),
  postalAddress: z.string().trim().min(10).max(200),
});

export async function GET() {
  const user = await me();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("email_identities")
    .select("from_email, from_name, postal_address, verified")
    .eq("user_id", user.id)
    .maybeSingle();

  let verified = Boolean(data?.verified);
  if (data?.from_email) {
    const domain = (data.from_email as string).split("@")[1] ?? "";
    const live = await domainVerified(domain);
    if (live !== null && live !== verified) {
      verified = live;
      await admin
        .from("email_identities")
        .update({ verified, verified_at: live ? new Date().toISOString() : null })
        .eq("user_id", user.id);
    }
  }

  return NextResponse.json({
    identity: data ? { ...data, verified } : null,
    providerConfigured: configured(),
    suppressions: await suppressionSummary(user.id),
  });
}

export async function POST(req: Request) {
  const user = await me();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A sending name, a valid address, and a real postal address are all required." },
      { status: 400 }
    );
  }

  const domain = parsed.data.fromEmail.split("@")[1] ?? "";
  const live = await domainVerified(domain);

  const admin = createAdminClient();
  const { error } = await admin.from("email_identities").upsert({
    user_id: user.id,
    from_email: parsed.data.fromEmail,
    from_name: parsed.data.fromName,
    postal_address: parsed.data.postalAddress,
    verified: live === true,
    verified_at: live === true ? new Date().toISOString() : null,
  });
  if (error) return NextResponse.json({ error: "Could not save that." }, { status: 500 });

  return NextResponse.json({
    ok: true,
    verified: live === true,
    // Told plainly rather than left for them to discover when nothing sends.
    note:
      live === true
        ? null
        : `${domain} is not verified with your sending provider yet, so nothing will send until it is.`,
  });
}
