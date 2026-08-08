// WHO IS ALLOWED TO TRIGGER A CRON JOB.
//
// Both cron endpoints previously guarded themselves like this:
//
//     const secret = process.env.CRON_SECRET;
//     if (secret) { ...check the bearer token... }
//
// Which reads as a check and is not one. With CRON_SECRET unset the whole block is
// skipped and the endpoint is open to anyone who knows the URL. The comment above the
// email cron even stated that "an unauthenticated call is refused rather than treated
// as a harmless no-op", which was simply not true in the configuration the project
// actually shipped with.
//
// WHAT AN OPEN CRON ENDPOINT COSTS HERE, concretely:
//   /api/cron/email    drains a customer's outreach queue, burning their sending
//                      reputation, which is the asset the whole product protects.
//   /api/cron/digest   mails every subscriber, and now also runs the accuracy
//                      sampling, which spends real Twilio and ZeroBounce money on
//                      every call.
//
// So this FAILS CLOSED in production. A missing secret is refused, loudly, rather than
// quietly meaning "let everybody in": a deployment that forgot to set it should have a
// cron that stops, which is visible, rather than a cron that anyone can drive, which is
// not. That is the opposite of the old behaviour and it is the entire point.
//
// Development stays permissive so `curl localhost:3000/api/cron/digest` still works
// without ceremony. The distinction is drawn on the deployment environment, never on
// anything in the request, because everything in the request is attacker-controlled.
//
// NO next/server IMPORT HERE, deliberately. The decision is a pure function of the
// header and the environment, so it can be tested directly; the routes turn a verdict
// into a response. Importing NextResponse to build the refusal made the whole module
// untestable outside a running server, which is how a guard like the old one survives.

export type CronVerdict = "allow" | "unconfigured" | "unauthorised";

/** Are we running somewhere the public can reach? */
export function isPublicDeployment(env: NodeJS.ProcessEnv = process.env): boolean {
  // Vercel sets VERCEL_ENV to production | preview | development. Preview deployments
  // have public URLs too, so they are guarded exactly like production.
  const vercel = env.VERCEL_ENV;
  if (vercel) return vercel !== "development";
  return env.NODE_ENV === "production";
}

/**
 * May this request run the job?
 *
 *   allow          proceed
 *   unconfigured   public deployment with no CRON_SECRET: refuse, and say why
 *   unauthorised   secret is set and the caller did not present it
 */
export function cronVerdict(
  authHeader: string | null,
  env: NodeJS.ProcessEnv = process.env
): CronVerdict {
  const secret = env.CRON_SECRET;

  if (!secret) {
    // Locally there is no secret configured and nothing public to protect.
    return isPublicDeployment(env) ? "unconfigured" : "allow";
  }

  return authHeader === `Bearer ${secret}` ? "allow" : "unauthorised";
}

/** The refusal to send, as a plain object the route wraps in a NextResponse. */
export function cronRefusal(verdict: Exclude<CronVerdict, "allow">, job: string): {
  status: number;
  body: { error: string };
} {
  if (verdict === "unconfigured") {
    // Loud, because the symptom of getting this wrong is a job that silently stops.
    console.error(
      `[cron:${job}] REFUSED: CRON_SECRET is not set. This endpoint spends money and ` +
        `sends mail, so it will not run unauthenticated in production. Set CRON_SECRET ` +
        `in the deployment environment and in the cron's Authorization header.`
    );
    return { status: 503, body: { error: "Cron is not configured on this deployment." } };
  }

  console.warn(`[cron:${job}] refused an unauthenticated call`);
  return { status: 401, body: { error: "Not authorised" } };
}
