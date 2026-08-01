import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userIdForApiKey } from "@/lib/api-keys";
import { getUnlockedKeys } from "@/lib/credits";
import { stripeConfigured } from "@/lib/stripe";
import { pushLeads as pushHubspot } from "@/lib/crm/hubspot";
import { pushLeads as pushSalesforce } from "@/lib/crm/salesforce";
import type { Lead } from "@/lib/types";
import { toolsGate } from "@/lib/tools-gate";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(500),
  provider: z.enum(["hubspot", "salesforce"]).default("hubspot"),
});

// Push leads into the connected CRM.
//
// FREE. The credit was already spent when the lead was opened, and charging again to
// move it somewhere would be charging twice for the same business. Only leads the
// customer already owns can be pushed, which is what stops this becoming a way to
// extract locked contact details.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user: cookieUser } } = await supabase.auth.getUser();
    const userId = cookieUser?.id ?? (await userIdForApiKey(req.headers.get("authorization")));
    if (!userId) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
    const gate = await toolsGate(userId);
    if (gate) return gate;

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const admin = createAdminClient();
    const { data: rows } = await admin
      .from("leads")
      .select("id, source, source_id, raw")
      .eq("user_id", userId)
      .in("id", parsed.data.leadIds);

    const owned = stripeConfigured() ? await getUnlockedKeys(userId) : null;
    const leads = (rows ?? [])
      .filter((r) => r.raw)
      // Only businesses this customer has paid to open. A locked lead has no contact
      // details to push anyway, and sending it would leak the fact it exists.
      .filter((r) => !owned || owned.has(`${r.source}:${r.source_id}`))
      .map((r) => r.raw as unknown as Lead);

    if (leads.length === 0) {
      return NextResponse.json(
        { error: "None of those leads are open yet. Open a lead before pushing it.", code: "not_owned" },
        { status: 409 }
      );
    }

    const result = parsed.data.provider === "salesforce"
      ? await pushSalesforce(userId, leads)
      : await pushHubspot(userId, leads);

    if (result.error === "not_connected") {
      return NextResponse.json(
        { error: `Connect ${parsed.data.provider === "salesforce" ? "Salesforce" : "HubSpot"} first, or reconnect it.`, code: "not_connected" },
        { status: 409 }
      );
    }
    if (result.error) {
      return NextResponse.json(
        { error: "Your CRM rejected the push. Nothing was changed on your side.", code: result.error },
        { status: 502 }
      );
    }

    return NextResponse.json({ pushed: result.pushed, skipped: result.skipped });
  } catch (e) {
    console.error("[crm-push]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not push those leads." }, { status: 500 });
  }
}
