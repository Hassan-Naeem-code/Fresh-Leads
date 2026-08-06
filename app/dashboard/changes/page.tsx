import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireSubscription } from "@/lib/require-subscription";
import { changesForUser, partition, territoryChanges } from "@/lib/changes";
import { Empty } from "../../admin/Empty";
import { Flame, Phone, Globe, ArrowRight, Clock, Lock, MapPin } from "../../icons";

export const metadata: Metadata = { title: "What changed", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// The screen that makes change detection a reason to log in.
//
// It was already being detected and stored; the only surfaces were a chip on a lead
// and an email on Mondays. That means the one signal no standing database can sell
// was invisible unless you happened to be looking at the right lead on the right day.
export default async function ChangesPage() {
  await requireSubscription("history");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/changes");

  const [changes, territories] = await Promise.all([
    changesForUser(user.id),
    territoryChanges(user.id),
  ]);
  const { act, watch } = partition(changes);
  const territoryTotal = territories.reduce((n, t) => n + t.changed, 0);

  const row = (c: (typeof changes)[number], urgent: boolean) => (
    <li key={`${c.leadKey}-${c.kind}-${c.detectedOn}`} className={urgent ? "chgrow act" : "chgrow"}>
      <span className="chgicon">{urgent ? <Flame size={15} /> : <Clock size={15} />}</span>
      <div className="chgmain">
        <b>{c.business ?? "A business you opened"}</b>
        <span className="chglabel">{c.label}</span>
        <span className="muted sm">
          since {new Date(c.since).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          {c.city ? `, ${c.city}` : ""}
        </span>
      </div>
      <div className="chgactions">
        {c.phone && <a className="ghost sm" href={`tel:${c.phone}`}><Phone size={13} /> Call</a>}
        {c.website && (
          <a className="ghost sm" href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer">
            <Globe size={13} /> Site
          </a>
        )}
      </div>
    </li>
  );

  return (
    <div className="wrap">
      <div className="app-head">
        <span className="app-eyebrow"><Flame size={13} /> What changed</span>
        <h1>Reasons to call this week.</h1>
        <p>
          We photograph every business you have opened and compare it against the last time
          we looked. A site that goes down, a booking system that appears, a vendor that gets
          swapped: none of it is in anybody's database, because it only exists as a
          difference between two visits.
        </p>
      </div>

      {/* WHAT MOVED IN THE WHOLE TERRITORY, not only where money has been spent.
          Scoped to leads they had opened, this page was empty for anybody who had not
          bought anything yet, so the one signal no standing database can sell was
          invisible until you had already bought enough of the product to see it.
          A business they own shows what changed. One they do not shows only THAT it
          changed, exactly as a locked lead shows a grade without the signals: the words
          are the sellable part. */}
      {territories.length > 0 && (
        <div className="card">
          <h3 className="cardtitle"><MapPin size={16} /> Across your saved searches</h3>
          <p className="muted sm">
            {territoryTotal} {territoryTotal === 1 ? "business has" : "businesses have"} moved
            in the areas you watch. We photograph them nightly whether you search or not, so
            this fills in on its own.
          </p>
          {territories.map((t) => (
            <div className="terr" key={t.watchlistId}>
              <div className="terrhead">
                <b>{t.watchlistName}</b>
                <span className="muted sm">
                  {t.changed} changed, {t.opened} of them yours
                </span>
              </div>
              <ul className="chglist">
                {t.businesses.slice(0, 8).map((b) => (
                  <li className="chgrow" key={b.leadKey}>
                    <span className="chgicon">{b.labels ? <Flame size={15} /> : <Lock size={14} />}</span>
                    <div className="chgmain">
                      <b>{b.name}</b>
                      {b.labels ? (
                        <span className="chglabel">{b.labels[0]}</span>
                      ) : (
                        <span className="muted sm">
                          {b.changeCount} {b.changeCount === 1 ? "change" : "changes"}, open the lead to see what
                        </span>
                      )}
                      {b.city && <span className="muted sm">{b.city}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {changes.length === 0 && territories.length === 0 ? (
        <Empty
          icon={<Flame size={22} />}
          title="Nothing has changed yet"
          hint="Save a search and we watch that whole area nightly, not just the leads you open. A change usually takes a week or two to appear, because most small business websites do not change overnight."
          action={<Link className="go accent" href="/dashboard">Run a search <ArrowRight size={15} /></Link>}
        />
      ) : (
        <>
          {act.length > 0 && (
            <div className="card">
              <h3 className="cardtitle"><Flame size={16} /> Call these today</h3>
              <p className="muted sm">
                Something broke or stopped. The window where this is worth mentioning is
                short, which is the whole point of knowing about it.
              </p>
              <ul className="chglist">{act.map((c) => row(c, true))}</ul>
            </div>
          )}

          {watch.length > 0 && (
            <div className="card">
              <h3 className="cardtitle">Worth knowing</h3>
              <p className="muted sm">
                They started or fixed something. Useful context for a call you were making
                anyway, rather than a reason to pick up the phone now.
              </p>
              <ul className="chglist">{watch.map((c) => row(c, false))}</ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
