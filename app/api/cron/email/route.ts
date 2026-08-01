import { NextRequest, NextResponse } from "next/server";
import { runDueSteps } from "@/lib/email/send";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// The scheduler's entry point. Vercel Cron calls this; nothing else should be able to.
//
// Vercel signs its cron requests with CRON_SECRET. Without that check this endpoint
// would let anyone on the internet drain a customer's sending queue at will, so an
// unauthenticated call is refused rather than treated as a harmless no-op.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Not authorised" }, { status: 401 });
    }
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
  const summary = await runDueSteps(origin);

  // Logged as one line so a problem shows up as a number in the Vercel logs rather
  // than as silence.
  console.log("[email-cron]", JSON.stringify(summary));
  return NextResponse.json(summary);
}
