import { NextRequest, NextResponse } from "next/server";
import { runDueSteps } from "@/lib/email/send";
import { siteUrl } from "@/lib/site-url";
import { cronVerdict, cronRefusal } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// The scheduler's entry point. Vercel Cron calls this; nothing else should be able to.
//
// ONCE A DAY, because the Hobby plan permits nothing more frequent: a sub-daily
// schedule fails the deployment outright with "Hobby accounts are limited to daily
// cron jobs". That is survivable here because sequence delays are measured in DAYS,
// so a daily tick sends everything due that day. It does mean a step scheduled for
// "1 day later" goes out at the next daily run rather than exactly 24 hours on.
//
// Two ways to make it finer later: upgrade the plan, or point any external scheduler
// at this same URL with the CRON_SECRET as a bearer token. Nothing in the sender
// assumes a particular frequency.
//
// Vercel signs its cron requests with CRON_SECRET. Without that check this endpoint
// would let anyone on the internet drain a customer's sending queue at will, so an
// unauthenticated call is refused rather than treated as a harmless no-op.
//
// That sentence used to be false. The guard was `if (secret) { ...check... }`, so a
// deployment with no CRON_SECRET skipped the check entirely and the endpoint was open,
// which is the exact configuration this project shipped with. It now fails closed in
// production (lib/cron-auth.ts): no secret means no cron, rather than no lock.
export async function GET(req: NextRequest) {
  // Fails closed in production: a missing CRON_SECRET refuses the call rather than
  // waving it through. See lib/cron-auth.ts for what an open endpoint here costs.
  const verdict = cronVerdict(req.headers.get("authorization"));
  if (verdict !== "allow") {
    const r = cronRefusal(verdict, "email");
    return NextResponse.json(r.body, { status: r.status });
  }

  // The canonical site, never the request host. These become unsubscribe links in
  // real mail, and a link built from a deployment URL is dead the moment that
  // deployment is superseded.
  const origin = siteUrl();
  const summary = await runDueSteps(origin);

  // Logged as one line so a problem shows up as a number in the Vercel logs rather
  // than as silence.
  console.log("[email-cron]", JSON.stringify(summary));
  return NextResponse.json(summary);
}
