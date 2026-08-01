import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { handleDeliveryEvent } from "@/lib/email/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Delivery events from the provider. This is how a bounce or a spam complaint reaches
// the suppression list without anyone having to notice it.
//
// Verified with the provider's signing secret. An unsigned webhook endpoint that writes
// to a suppression list would let anyone suppress a customer's prospects.

const RELEVANT: Record<string, "bounced" | "complained" | "delivered"> = {
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.delivered": "delivered",
};

function verified(raw: string, req: NextRequest): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  // No secret configured means we cannot tell a real event from a forged one, so the
  // endpoint refuses everything rather than trusting it.
  if (!secret) return false;

  const sig = req.headers.get("svix-signature") ?? "";
  const id = req.headers.get("svix-id") ?? "";
  const ts = req.headers.get("svix-timestamp") ?? "";
  if (!sig || !id || !ts) return false;

  // Svix signs "id.timestamp.body" with a base64 secret, and sends one or more
  // space separated "v1,<sig>" values.
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${raw}`).digest("base64");

  return sig.split(" ").some((part) => {
    const value = part.startsWith("v1,") ? part.slice(3) : part;
    const a = Buffer.from(value);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  if (!verified(raw, req)) {
    return NextResponse.json({ error: "Signature could not be verified" }, { status: 401 });
  }

  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const kind = RELEVANT[event.type ?? ""];
  const providerId = event.data?.email_id;

  // An event we do not act on is still a success. Answering anything else invites the
  // provider to retry something we will never handle.
  if (!kind || !providerId) return NextResponse.json({ ok: true, ignored: true });

  try {
    await handleDeliveryEvent(providerId, kind);
  } catch (e) {
    // 500 so the provider retries. Losing a bounce means continuing to mail a dead
    // address, which is exactly what damages a sending reputation.
    console.error("[email-webhook]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not record that event" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
