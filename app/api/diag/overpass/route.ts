import { NextRequest, NextResponse } from "next/server";
import { guard, clientIp } from "@/lib/rate-limit";
import { geocode } from "@/lib/geocode";
import { resolveNiche } from "@/lib/niche";
import { pickSources } from "@/lib/sources";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

// A single question: does Overpass answer us from THIS host?
//
// Discovery returns OpenStreetMap rows from a laptop and zero from production, which
// decides whether the search cache can ever fill and, beyond that, whether the whole
// product is running on Google Places alone. Inference from an empty table was not
// going to settle it, so this asks directly and reports what came back.
//
// Read only, returns no customer data and no configuration, and rate limited. It is
// small enough to keep as an operational check rather than deleting after one use:
// the next time discovery looks wrong, this answers in one request.
export async function GET(req: NextRequest) {
  const limited = await guard("search", clientIp(req), "diagnostics");
  if (limited) return limited;

  // Uses the REAL client, not a hand written fetch.
  //
  // The first version of this sent a bare request without our User-Agent and got 406
  // and 429 from both endpoints, from the deployed host AND from a laptop. That looked
  // like a decisive result and was worth nothing: it proved only that Overpass rejects
  // anonymous requests, which we already knew and already handle. A diagnostic that
  // does not exercise the path being diagnosed answers a different question confidently.
  const area = await geocode("Austin, TX");
  if (!area) {
    return NextResponse.json({ error: "geocoding failed, which is its own problem" }, { status: 502 });
  }

  const resolved = resolveNiche("cafes");
  const source = pickSources().find((s) => s.name === "osm");
  if (!source) {
    return NextResponse.json({ error: "the OpenStreetMap source is not configured" }, { status: 500 });
  }

  const started = Date.now();
  let rows = -1;
  let failure: string | null = null;
  try {
    const found = await source.search({
      filters: resolved.filters,
      nicheLabel: resolved.label,
      area,
      limit: 20,
    });
    rows = found.length;
  } catch (e) {
    failure = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 200) : "threw";
  }

  const results = [
    {
      via: "the real OverpassSource, same headers and retries as a live search",
      area: area.displayName,
      rows,
      ms: Date.now() - started,
      failure,
    },
  ];

  return NextResponse.json({ ranFrom: "server", results });
}
