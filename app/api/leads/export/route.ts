import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { unlockLeadsBulk, getCreditBalance, getUnlockedKeys } from "@/lib/credits";
import { verifyAndPersist } from "@/lib/verify/persist";
import { mapPool } from "@/lib/pool";
import { stripeConfigured } from "@/lib/stripe";
import { getAccess } from "@/lib/access";
import { getSiteSettings } from "@/lib/site-settings.server";
import { gradePct, LEGACY_ATTAINABLE } from "@/lib/score";
import type { Lead } from "@/lib/types";

export const runtime = "nodejs";

const Body = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(1000),
  /** csv for a CRM, pdf for a call sheet. PDF is a subscriber feature. */
  format: z.enum(["csv", "pdf"]).default("csv"),
});

// Export leads to CSV. One credit per lead, and leads already unlocked are FREE,
// because a credit buys a business permanently, not one view of it.
//
// The CSV is built here rather than in the browser for the same reason unlocking
// is: the rows contain the contact details, so they must not be sent to a client
// that hasn't paid for them. The charge is all-or-nothing, so a user never gets a
// half-complete file.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    // The PDF call sheet is what the yearly subscription buys on top of the raw data.
    // Checked before any credit is spent, so a refusal never costs anything.
    const wantsPdf = parsed.data.format === "pdf";
    if (wantsPdf && stripeConfigured()) {
      const access = await getAccess(user.id);
      if (!access.subscribed) {
        return NextResponse.json(
          {
            error: "The PDF call sheet is part of the $30/year plan. CSV export is always available.",
            code: "subscription_required",
          },
          { status: 403 }
        );
      }
    }

    const admin = createAdminClient();
    const { data: rows } = await admin
      .from("leads")
      .select("id, source, source_id, raw")
      .eq("user_id", user.id)
      .in("id", parsed.data.leadIds);

    const usable = (rows ?? []).filter((r) => r.raw);
    if (usable.length === 0) {
      return NextResponse.json(
        { error: "Those leads are no longer available, please run the search again." },
        { status: 404 }
      );
    }

    // Paid verification, once per lead, before anything is charged, the same rule the
    // single-lead unlock follows (see lib/verify/persist.ts). An export of 200 leads is
    // an export of 200 credits, so it is exactly where charging for a dead phone number
    // would hurt most. Leads already paid for skip this: they were verified when bought.
    const owned = await getUnlockedKeys(user.id);
    await mapPool(usable, 12, (r) =>
      verifyAndPersist(r.raw as unknown as Lead, r.id as string)
    );

    // Drop the ones we just proved unreachable, unless they are already owned, those
    // were bought and stay in the file whatever the re-check says.
    const isDead = (r: (typeof usable)[number]) =>
      !(r.raw as unknown as Lead).deliverable && !owned.has(`${r.source}:${r.source_id}`);
    const dead = usable.filter(isDead);
    const deliverable = usable.filter((r) => !isDead(r));

    if (deliverable.length === 0) {
      return NextResponse.json(
        {
          error:
            "None of those leads passed verification, their phones and emails are dead. " +
            "You haven't been charged.",
          code: "unverifiable",
          skipped: dead.length,
        },
        { status: 409 }
      );
    }

    const keys = deliverable.map((r) => `${r.source}:${r.source_id}`);

    if (stripeConfigured()) {
      const { ok, charged, creditsLeft } = await unlockLeadsBulk(user.id, keys);
      if (!ok) {
        // `charged` is what the batch WOULD have cost, so the UI can say exactly
        // how many more credits are needed.
        return NextResponse.json(
          {
            error: `This export needs ${charged} credit${charged === 1 ? "" : "s"} and you have ${creditsLeft}.`,
            code: "insufficient_credits",
            needed: charged,
            credits: creditsLeft,
          },
          { status: 402 }
        );
      }
    }

    const exportLeads = deliverable.map((r) => r.raw as unknown as Lead);
    const credits = await getCreditBalance(user.id);
    const stamp = new Date().toISOString().slice(0, 10);

    if (wantsPdf) {
      const [{ buildLeadsPdf }, settings] = await Promise.all([
        import("@/lib/pdf"),
        getSiteSettings(),
      ]);
      const bytes = await buildLeadsPdf(exportLeads, {
        brand: settings.brand_name || "Fresh Leads",
        generatedAt: new Date(),
      });
      return new NextResponse(Buffer.from(bytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="fresh-leads-${stamp}.pdf"`,
          "X-Credits-Remaining": String(credits),
          "X-Leads-Skipped": String(dead.length),
        },
      });
    }

    const csv = toCsv(exportLeads);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="fresh-leads-${stamp}.csv"`,
        // So the client can update the balance in the header without a refetch.
        "X-Credits-Remaining": String(credits),
        // How many were left out for failing verification, so the UI can say so
        // instead of the user silently getting fewer rows than they selected.
        "X-Leads-Skipped": String(dead.length),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[export]", msg);
    return NextResponse.json({ error: "Could not export these leads." }, { status: 500 });
  }
}

const COLUMNS = [
  "name", "category", "grade", "tier", "verified", "owner", "ownerRole", "ownerEmail",
  "phone", "phoneVerified", "email", "emailStatus", "website", "address", "city",
  "activeStatus", "hiring", "facebook", "instagram", "linkedin", "needSignals",
  "gradeBreakdown", "freshness", "listingUpdated", "pitch", "mapUrl",
] as const;

function cell(l: Lead, col: (typeof COLUMNS)[number]): string | number {
  switch (col) {
    case "grade":
      return gradePct(l.score, l.scoreMax || LEGACY_ATTAINABLE);
    case "verified":
      return l.deliverable ? "yes" : "no";
    case "phoneVerified":
      return l.phoneValid ? "yes" : "no";
    case "owner":
      return l.ownerName ?? "";
    case "ownerRole":
      return l.ownerRole ?? "";
    case "ownerEmail":
      return l.ownerEmail ?? "";
    case "hiring":
      // Blank rather than "no" when we never managed to read their site: an empty
      // cell is honest about not knowing, "no" is a claim we cannot support.
      return l.hiring === null || l.hiring === undefined ? "" : l.hiring ? "yes" : "no";
    case "facebook":
    case "instagram":
    case "linkedin":
      return l.socials?.[col] ?? "";
    case "needSignals":
      return l.needSignals.join("; ");
    case "gradeBreakdown":
      return l.scoreFactors.map((f) => `${f.label} +${f.points}`).join("; ");
    case "freshness":
      return `${l.freshness} (${l.freshnessLabel})`;
    case "listingUpdated":
      return l.lastUpdated ?? "";
    default:
      return (l as unknown as Record<string, string | number>)[col] ?? "";
  }
}

function toCsv(leads: Lead[]): string {
  // Prefix anything Excel would treat as a formula, so a business name starting
  // with = or + can't turn into one when the file is opened.
  const esc = (v: string | number) => {
    const str = String(v ?? "");
    const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const header = COLUMNS.join(",");
  const body = leads.map((l) => COLUMNS.map((c) => esc(cell(l, c))).join(","));
  return [header, ...body].join("\r\n");
}
