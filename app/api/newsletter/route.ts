import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, clientIp } from "@/lib/rate-limit";
import { notifyNewsletterConfirm } from "@/lib/email/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Joining and leaving the mailing list.
//
// DOUBLE OPT IN, and not as a formality. Anyone can type anyone's address into a public
// form, and a list built from unconfirmed addresses generates spam complaints against
// the domain that also sends every two factor code and receipt in this product. Losing
// that domain's reputation would break the parts people have paid for.
//
// The reply is always the same whether the address is new, already subscribed, or
// already unsubscribed. A form that says "you are already on this list" is a way to ask
// whether a given person is a customer.

const Body = z.object({
  email: z.string().email().max(200),
  source: z.string().max(40).optional(),
  // Honeypot. Deliberately NOT max(0): a schema that rejects the trap answers 400 and
  // tells the bot exactly which field caught it. Accepting anything here lets the
  // explicit check below return a cheerful success instead, which teaches it nothing.
  website: z.string().max(200).optional().default(""),
});

export async function POST(req: NextRequest) {
  const limited = await guard("contact", clientIp(req), "sign ups");
  if (limited) return limited;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email" }, { status: 400 });
  if (parsed.data.website) return NextResponse.json({ ok: true });

  const email = parsed.data.email.trim().toLowerCase();
  const admin = createAdminClient();

  try {
    const { data: existing } = await admin
      .from("newsletter_subscribers")
      .select("id, token, confirmed_at")
      .eq("email", email)
      .maybeSingle();

    let token = existing?.token as string | undefined;

    if (!existing) {
      token = randomBytes(24).toString("base64url");
      const { error } = await admin.from("newsletter_subscribers").insert({
        email,
        token,
        source: parsed.data.source ?? null,
      });
      if (error) throw error;
    } else if (existing.confirmed_at) {
      // Already on the list and confirmed. Say nothing that reveals that, and do not
      // send another email: a form that mails somebody every time it is submitted is a
      // way to use us to harass an address.
      return NextResponse.json({ ok: true });
    } else {
      // Asked before and never confirmed. Clearing the unsubscribe stamp would be wrong
      // here; sending the confirmation again is the whole point of them trying twice.
      await admin
        .from("newsletter_subscribers")
        .update({ unsubscribed_at: null })
        .eq("id", existing.id);
    }

    if (token) await notifyNewsletterConfirm({ to: email, token });
  } catch (e) {
    console.error("[newsletter]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not sign you up. Try again shortly." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
