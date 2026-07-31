import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUnlockedKeys, getOwnerUnlockedKeys } from "@/lib/credits";
import { stripeConfigured } from "@/lib/stripe";
import type { Lead, ResultLead } from "@/lib/types";
import { viewLead } from "@/lib/lead-view";
import { HistoryLeads } from "./HistoryLeads";

// A saved search. Leads the user has paid for are shown in full; the rest are still
// locked and can be unlocked from here, at the same price as anywhere else.
//
// This page used to render every saved lead with the full LeadCard, which handed out
// the contact details of leads that were never paid for. The lock state has to be
// applied wherever leads are displayed, not only on the search screen.
export default async function SearchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/dashboard/history/${id}`);

  // RLS ensures the search belongs to the signed-in user.
  const { data: search } = await supabase
    .from("searches")
    .select("id, niche, location, resolved_area, scanned_at")
    .eq("id", id)
    .maybeSingle();
  if (!search) notFound();

  // Service-role read so we get the row ids needed to unlock, still scoped to this
  // user as well as this search.
  const admin = createAdminClient();
  const { data: leadRows } = await admin
    .from("leads")
    .select("id, source, source_id, raw")
    .eq("search_id", id)
    .eq("user_id", user.id)
    .order("score", { ascending: false });

  const unlocked = await getUnlockedKeys(user.id);
  // Owner detail is bought separately, so history has to honour the same gate the
  // live search does. Without this a saved lead would show a person the customer
  // never paid for.
  const ownerKeys = await getOwnerUnlockedKeys(user.id);
  const everythingOpen = !stripeConfigured();

  const leads: ResultLead[] = (leadRows ?? [])
    .map((r): ResultLead | null => {
      const lead = r.raw as unknown as Lead | null;
      if (!lead?.id) return null;
      return viewLead(lead, {
        dbId: r.id as string,
        leadKey: `${r.source}:${r.source_id}`,
        unlockedKeys: unlocked,
        ownerKeys,
        everythingOpen,
      });
    })
    .filter((l): l is ResultLead => l !== null);

  const ownedCount = leads.filter((l) => !l.locked).length;
  const genuine = leads.filter((l) => l.deliverable).length;

  return (
    <div className="wrap">
      <div className="app-head">
        <Link
          href="/dashboard/history"
          className="linkish"
          style={{ display: "inline-block", marginBottom: 12 }}
        >
          ← Back to history
        </Link>
        <h1>
          {search.niche} · {search.location}
        </h1>
        <p>
          {new Date(search.scanned_at).toLocaleString()}
          {search.resolved_area ? ` · ${search.resolved_area}` : ""} · {leads.length} leads
          {genuine ? ` · ${genuine} genuine` : ""}
          {leads.length > 0 ? ` · ${ownedCount} of ${leads.length} yours` : ""}
        </p>
      </div>

      {leads.length === 0 ? (
        <div className="card empty">No leads were saved for this search.</div>
      ) : (
        <HistoryLeads leads={leads} niche={search.niche} location={search.location} />
      )}
    </div>
  );
}
