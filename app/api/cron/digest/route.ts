import { NextRequest, NextResponse } from "next/server";
import { runWeeklyDigest, isDigestDay } from "@/lib/digest";
import { purgeExpired } from "@/lib/housekeeping";

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

  // Housekeeping rides along here rather than in a third cron, because the plan
  // allows two and both are spoken for. It runs every day regardless of whether the
  // digest sent anything: expired challenges and stale counters accumulate daily,
  // and a table that only gets tidied on Mondays is a table that grows all week.
  const purged = await purgeExpired();

  console.log("[digest-cron]", JSON.stringify({ digestDay: isDigestDay(), force, ...summary, purged }));
  return NextResponse.json({ ...summary, purged });
}
