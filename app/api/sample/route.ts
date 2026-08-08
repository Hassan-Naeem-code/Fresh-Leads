import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runSample, sampleFromCache } from "@/lib/sample";
import { guard } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const Body = z.object({
  niche: z.string().min(2).max(80),
  location: z.string().min(2).max(80),
});

// THE ONLY UNAUTHENTICATED ENDPOINT IN THIS PRODUCT THAT SPENDS MONEY.
//
// It runs a real search so a visitor can see real businesses before signing up, which
// is the entire point: everything else here refuses to claim what it has not
// established, and then the landing page showed an invented result set.
//
// That makes it the endpoint most worth attacking, so the order of operations below is
// deliberate and is the whole safety story:
//
//   1. Parse. A malformed body must not reach a rate limiter or a crawler.
//   2. CACHE FIRST, before any limit is counted. A cached answer costs one row read,
//      so a popular city must not consume anyone's quota. Checking the limit first
//      would make the landing page fail for the visitors it works best for.
//   3. Per-visitor limit, keyed on IP.
//   4. Global limit. IPs are cheap to obtain and this is the one that bounds the bill
//      whatever the distribution of callers.
//
// The response carries no phone, no email and no need signals. That redaction happens
// in lib/sample.ts against the same definition the product uses for a locked lead, so
// this route cannot be made laxer by an edit here.
export async function POST(req: NextRequest) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Tell us a business type and a place, e.g. dentists in Austin, TX." },
        { status: 400 }
      );
    }
    const { niche, location } = parsed.data;

    // Cache first, deliberately. See note above.
    const cached = await sampleFromCache(niche, location);
    if (cached) return NextResponse.json(cached);

    // Vercel puts the real client address first in x-forwarded-for. Falling back to a
    // constant is intentional: an unknown address shares one bucket rather than
    // getting a free pass, so a stripped header cannot bypass the limit.
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    const perVisitor = await guard("sample", ip, "sample searches");
    if (perVisitor) return perVisitor;

    const globally = await guard("sample_global", "all", "sample searches right now");
    if (globally) return globally;

    const result = await runSample(niche, location);
    if ("error" in result) {
      // 200, not 4xx. "No dentists in this village" is a real answer to a real
      // question, and rendering it as a failure would tell the visitor our product is
      // broken when it has just told them something true.
      return NextResponse.json(result);
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error("[sample]", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: "That search did not finish. Please try again.", code: "no_results" },
      { status: 200 }
    );
  }
}
