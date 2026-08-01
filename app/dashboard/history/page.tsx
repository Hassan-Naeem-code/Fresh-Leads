import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireSubscription } from "@/lib/require-subscription";
import { ChevronRight } from "../../icons";

type SearchRow = {
  id: string;
  niche: string;
  location: string;
  resolved_area: string | null;
  scanned_at: string;
  leads: { count: number }[];
};

export default async function HistoryPage() {
  await requireSubscription("history");
  const supabase = await createClient();
  const { data } = await supabase
    .from("searches")
    .select("id, niche, location, resolved_area, scanned_at, leads(count)")
    .order("scanned_at", { ascending: false })
    .limit(50);

  const searches = (data ?? []) as SearchRow[];

  return (
    <div className="wrap">
      <div className="app-head">
        <h1>Search history</h1>
        <p>Every batch of leads you&rsquo;ve pulled, newest first. Open one to review or re-export it.</p>
      </div>

      {searches.length === 0 ? (
        <div className="card empty">
          No searches yet. <Link href="/dashboard" className="linkish">Run your first search</Link>.
        </div>
      ) : (
        <div className="leads">
          {searches.map((s) => {
            const count = s.leads?.[0]?.count ?? 0;
            return (
              <Link
                className="lead"
                key={s.id}
                href={`/dashboard/history/${s.id}`}
                style={{ gridTemplateColumns: "1fr auto auto", textDecoration: "none", color: "inherit" }}
              >
                <div>
                  <h3>{s.niche} · {s.location}</h3>
                  <div className="cat">
                    {new Date(s.scanned_at).toLocaleString()}
                    {s.resolved_area ? ` · ${s.resolved_area}` : ""}
                  </div>
                </div>
                <div className="scoreR"><b>{count}</b>leads</div>
                <span style={{ alignSelf: "center", color: "var(--muted)", display: "flex" }}>
                  <ChevronRight size={18} />
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
