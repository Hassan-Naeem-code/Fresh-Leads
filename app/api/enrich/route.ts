import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { userIdForApiKey } from "@/lib/api-keys";
import { getAccess } from "@/lib/access";
import { spendCredits } from "@/lib/credits";
import { stripeConfigured } from "@/lib/stripe";
import { mapPool } from "@/lib/pool";
import { parseCsv, enrichRow, toCsv, billableRows, type EnrichedRow } from "@/lib/bulk-enrich";
import { toolsGate } from "@/lib/tools-gate";

export const runtime = "nodejs";
export const maxDuration = 60;

// BULK ENRICHMENT. Send a CSV, get it back with everything we could find filled in.
//
// Priced exactly like a lead, because it is one: one credit per row we actually
// enriched. A row we could not identify comes back untouched and costs nothing, which
// is the same promise the unlock path already makes about unreachable leads.
//
// Works with a session cookie from the dashboard or an API key from a script.

const MAX_ROWS = 500;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user: cookieUser } } = await supabase.auth.getUser();
    const userId = cookieUser?.id ?? (await userIdForApiKey(req.headers.get("authorization")));
    if (!userId) {
      return NextResponse.json(
        { error: "Please sign in, or send an API key as Authorization: Bearer fl_live_..." },
        { status: 401 }
      );
    }

    const gate = await toolsGate(userId);
    if (gate) return gate;

    const csv = await req.text();
    const rows = parseCsv(csv, MAX_ROWS);
    if (rows.length === 0) {
      return NextResponse.json(
        {
          error:
            "That did not look like a CSV with a header row. Include a header naming at " +
            "least a business name, or a website.",
        },
        { status: 400 }
      );
    }

    // Enough credits for the worst case, checked before any work is done so a customer
    // is never billed for a partial run.
    let balance = Infinity;
    if (stripeConfigured()) {
      const access = await getAccess(userId);
      if (!access.hasAccess) {
        return NextResponse.json(
          { error: "Your account needs the yearly plan before you can enrich a list.", code: "subscription_required" },
          { status: 402 }
        );
      }
      balance = access.credits;
      if (balance < rows.length) {
        return NextResponse.json(
          {
            error: `That list is ${rows.length} rows and you have ${balance} credits. ` +
                   `You are charged only for rows we enrich, but we ask for the full amount up front.`,
            code: "insufficient_credits",
            needed: rows.length,
            credits: balance,
          },
          { status: 402 }
        );
      }
    }

    // Idempotency key for the charge. Derived from the caller and the list itself, so
    // a client that retries after a timeout is not billed a second time for the same
    // work. A clock based key would defeat that entirely.
    const ref = `enrich:${userId}:${createHash("sha256").update(csv).digest("hex").slice(0, 32)}`;

    const enriched = (await mapPool(rows, 8, (r) => enrichRow(r))) as EnrichedRow[];
    const billable = billableRows(enriched);

    // Charge for what was actually done, after the work, so a row we could not
    // identify costs nothing. `ref` makes the charge idempotent: a retried or
    // duplicated request settles on the same single charge.
    if (stripeConfigured() && billable > 0) {
      const { status, creditsLeft } = await spendCredits(userId, billable, "bulk_enrich", ref);
      if (status === "insufficient") {
        // Should be unreachable: the balance was checked before any work started. If
        // it happens, the customer spent their credits elsewhere mid-run, and the
        // honest answer is to hand back the work without charging.
        return NextResponse.json(
          {
            error: "Your balance changed while this list was running, so nothing was charged.",
            code: "insufficient_credits",
            credits: creditsLeft,
          },
          { status: 402 }
        );
      }
      balance = creditsLeft;
    }

    const wantsJson = (req.headers.get("accept") ?? "").includes("application/json");
    const stamp = new Date().toISOString().slice(0, 10);

    if (wantsJson) {
      return NextResponse.json({
        rows: enriched.length, enriched: billable, charged: billable,
        credits: balance === Infinity ? null : balance, leads: enriched,
      });
    }

    return new NextResponse(toCsv(enriched), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="fresh-leads-enriched-${stamp}.csv"`,
        "X-Rows-Enriched": String(billable),
        "X-Rows-Total": String(enriched.length),
        "X-Credits-Remaining": balance === Infinity ? "" : String(balance),
      },
    });
  } catch (e) {
    console.error("[enrich]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not enrich that list." }, { status: 500 });
  }
}
