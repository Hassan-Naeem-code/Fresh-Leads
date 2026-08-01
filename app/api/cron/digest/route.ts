import { NextRequest, NextResponse } from "next/server";
import { runWeeklyDigest, isDigestDay } from "@/lib/digest";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// The weekly summary's entry point.
//
// Fires DAILY and decides for itself whether today is the day, because the Hobby plan
// permits nothing finer than a daily schedule. That also puts the send day in code
// next to the logic rather than in a cron string, so changing it does not mean
// redeploying configuration.
//
// Same secret check as the sequence cron: without it, anyone on the internet could
// mail every customer at will.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Not authorised" }, { status: 401 });
    }
  }

  // ?force=1 ignores the weekday, for testing. It still respects the once-a-day guard
  // per person, so a stuck finger cannot mail somebody twice.
  const force = new URL(req.url).searchParams.get("force") === "1";
  const summary = await runWeeklyDigest(force);

  console.log("[digest-cron]", JSON.stringify({ digestDay: isDigestDay(), force, ...summary }));
  return NextResponse.json(summary);
}
