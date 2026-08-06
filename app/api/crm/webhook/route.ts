import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getEndpoint, saveEndpoint, removeEndpoint, pushLeads } from "@/lib/crm/webhook";
import { toolsGate } from "@/lib/tools-gate";
import { guard } from "@/lib/rate-limit";
import type { Lead } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Managing the outbound webhook destination.
//
// Kept separate from /api/crm/push, which sends real leads. This is the plumbing: set a
// destination, send a sample so the customer can build their Zap against a real payload,
// and remove it.

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), url: z.string().min(8).max(500) }),
  z.object({ action: z.literal("test") }),
  z.object({ action: z.literal("remove") }),
]);

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const endpoint = await getEndpoint(user.id);
  if (!endpoint) return NextResponse.json({ endpoint: null });

  return NextResponse.json({
    endpoint: {
      url: endpoint.url,
      // The secret IS shown on request, unlike an API key. It is a verification secret
      // rather than an access credential: knowing it lets somebody check our
      // signatures, not call anything of ours. Hiding it would only mean a customer who
      // lost it has to rotate the destination for no security gain.
      secret: endpoint.secret,
      lastSentAt: endpoint.lastSentAt,
      lastStatus: endpoint.lastStatus,
      lastError: endpoint.lastError,
    },
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const gate = await toolsGate(user.id);
  if (gate) return gate;

  const limited = await guard("account", user.id, "changes");
  if (limited) return limited;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  if (parsed.data.action === "remove") {
    return NextResponse.json({ ok: await removeEndpoint(user.id) });
  }

  if (parsed.data.action === "save") {
    const result = await saveEndpoint(user.id, parsed.data.url);
    return result.ok
      ? NextResponse.json({ ok: true, secret: result.secret })
      : NextResponse.json({ error: result.error }, { status: 400 });
  }

  // A sample delivery, so somebody can build their Zap against a real payload rather
  // than against documentation. Obviously fake data, clearly labelled, so a test cannot
  // be mistaken for a lead in whatever it lands in.
  const sample: Lead = {
    id: "sample:1",
    name: "Sample Dental Practice",
    category: "dentist",
    city: "Austin",
    address: "100 Example St, Austin, TX 78701",
    phone: "(512) 555-0142",
    email: "hello@example.com",
    website: "https://example.com",
    score: 68,
    scoreMax: 100,
    tier: "HOT",
    needSignals: ["Website down / unreachable", "No online booking"],
    pitch: "Their site has been unreachable since last week. Lead with that.",
    mapUrl: "https://www.google.com/maps",
  } as unknown as Lead;

  const result = await pushLeads(user.id, [sample]);
  return result.error
    ? NextResponse.json({ error: result.error }, { status: 400 })
    : NextResponse.json({ ok: true });
}
