import { NextRequest, NextResponse } from "next/server";
import { runWeeklyDigest, isDigestDay } from "@/lib/digest";
import { purgeExpired } from "@/lib/housekeeping";
import { refreshCache } from "@/lib/cache-refresh";
import { runQualitySample } from "@/lib/quality";
import { cronVerdict, cronRefusal } from "@/lib/cron-auth";

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
  // Fails closed in production: a missing CRON_SECRET refuses the call rather than
  // waving it through. See lib/cron-auth.ts for what an open endpoint here costs.
  const verdict = cronVerdict(req.headers.get("authorization"));
  if (verdict !== "allow") {
    const r = cronRefusal(verdict, "digest");
    return NextResponse.json(r.body, { status: r.status });
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

  // Keeping the search cache warm rides along here for the same reason housekeeping
  // does: the plan allows two cron jobs and both are spoken for. It has its own
  // budget, so a slow refresh cannot take the digest down with it.
  const cache = await refreshCache();

  // ACCURACY MEASUREMENT rides along for the same reason the two above do: the plan
  // allows two cron jobs and both are spoken for. It re-checks a random sample of the
  // leads customers actually paid for, which is the only unbiased number we have about
  // our own quality and the only one fit to publish (see lib/quality.ts). It owns its
  // own budget and swallows its own failures, so a bad measurement day cannot stop the
  // digest going out.
  const quality = await runQualitySample();

  console.log("[digest-cron]", JSON.stringify({ digestDay: isDigestDay(), force, ...summary, purged, cache, quality }));
  return NextResponse.json({ ...summary, purged, cache, quality });
}
