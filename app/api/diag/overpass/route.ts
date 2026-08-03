import { NextRequest, NextResponse } from "next/server";
import { guard, clientIp } from "@/lib/rate-limit";

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

  // A deliberately tiny query. If Overpass is willing to talk to us at all, this
  // returns in a second; if it is refusing or throttling, that shows up as a status
  // or a timeout rather than as a slow but successful answer.
  const query = `[out:json][timeout:20];node["amenity"="cafe"](30.20,-97.80,30.30,-97.70);out 5;`;

  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];

  const results = [];
  for (const url of endpoints) {
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
      });
      clearTimeout(timer);

      const text = await res.text();
      let elements = -1;
      try {
        elements = (JSON.parse(text).elements ?? []).length;
      } catch {
        // Not JSON. Overpass answers a rejection in prose, and the first line of it
        // is the useful part.
      }
      results.push({
        endpoint: new URL(url).hostname,
        status: res.status,
        ms: Date.now() - started,
        elements,
        // Truncated hard: this is for a human reading a rejection message, not a body dump.
        body: elements === -1 ? text.slice(0, 200).replace(/\s+/g, " ") : null,
      });
    } catch (e) {
      results.push({
        endpoint: new URL(url).hostname,
        status: 0,
        ms: Date.now() - started,
        elements: -1,
        body: e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 200) : "threw",
      });
    }
  }

  return NextResponse.json({ ranFrom: "server", results });
}
