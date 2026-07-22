import type { Lead } from "@/lib/types";
import { LEGACY_ATTAINABLE, bandFor, gradePct } from "@/lib/score";
import { bandFor as freshnessBandFor } from "@/lib/freshness";
import {
  Phone, Mail, Globe, GlobeOff, MapPin, Lightbulb, Building, ChevronRight, Dot, Check,
} from "./icons";

// Shared presentational lead card, used by the live dashboard results and the
// saved search-history detail view. Pure render, no hooks, so it works in both
// client and server components.
export function LeadCard({ lead: l }: { lead: Lead }) {
  const band = bandFor(l.tier);
  const fband = freshnessBandFor(l.freshness);
  // Grade against what was attainable FOR THIS LEAD. Leads saved to history before
  // scoreMax existed keep the scale they were originally graded on.
  const attainable = l.scoreMax || LEGACY_ATTAINABLE;
  const pct = gradePct(l.score, attainable);

  return (
    <div className="lead">
      <div className={`badge ${l.tier}`} title={`${band.label}: ${band.meaning}`}>
        {pct}<small>{l.tier}</small>
      </div>
      <div>
        <h3>{l.name}</h3>
        <div className="cat">
          {l.category.replace(/_/g, " ")}{l.city ? ` · ${l.city}` : ""}
          <span className={`fresh ${l.freshness}`} title={fband.meaning}>
            <Dot /> {fband.label} · listing updated {l.freshnessLabel}
          </span>
        </div>
        <div className="meta">
          {l.phone && <span><Phone size={14} /> <a href={`tel:${l.phone}`}>{l.phone}</a></span>}
          {l.email && <span><Mail size={14} /> <a href={`mailto:${l.email}`}>{l.email}</a></span>}
          {l.website
            ? <span><Globe size={14} /> <a href={l.website} target="_blank" rel="noreferrer">website</a></span>
            : <span className="off"><GlobeOff size={14} /> no website</span>}
          <span><MapPin size={14} /> <a href={l.mapUrl} target="_blank" rel="noreferrer">map</a></span>
        </div>
        <div className="verify">
          {l.deliverable && <span className="vbadge good"><Check size={11} /> Genuine</span>}
          {l.phoneValid && <span className="vbadge"><Phone size={11} /> phone verified</span>}
          {l.emailStatus === "deliverable" && <span className="vbadge"><Mail size={11} /> email verified</span>}
          {l.emailStatus === "risky" && <span className="vbadge"><Mail size={11} /> email likely</span>}
          {l.emailStatus === "undeliverable" && <span className="vbadge bad"><Mail size={11} /> email unreachable</span>}
          {l.activeStatus === "active" && <span className="vbadge"><Building size={11} /> active</span>}
          {l.activeStatus === "likely_closed" && <span className="vbadge bad">may be closed</span>}
        </div>
        <div className="signals">
          {l.needSignals.map((s, i) => (
            <span key={i} className={`sig ${/no |not |down|outdated|insecure/i.test(s) ? "bad" : ""}`}>{s}</span>
          ))}
        </div>
        <div className="pitch"><Lightbulb size={14} /> <span>{l.pitch}</span></div>

        <details className="brk">
          <summary>
            <ChevronRight size={13} className="chev" />
            Why grade {pct}?, {l.scoreFactors.length} factor{l.scoreFactors.length === 1 ? "" : "s"}
          </summary>
          <div className="brkbody">
            {l.scoreFactors.length === 0 && (
              <div className="brkrow muted">Nothing scored, solid web presence and no contact channel found.</div>
            )}
            {l.scoreFactors.map((f) => (
              <div className="brkrow" key={f.key}>
                <span className={`gtag ${f.group}`}>{f.group === "need" ? "NEED" : "REACH"}</span>
                <span className="brklabel">{f.label}</span>
                <span className="brkpts">+{f.points}</span>
              </div>
            ))}
            <div className="brkrow total">
              <span className="brklabel">Total</span>
              <span className="brkpts">{l.score} / {attainable} attainable</span>
            </div>
            <div className="bar"><i className={l.tier} style={{ width: `${pct}%` }} /></div>
            <div className="brknote">
              <b>{band.label}</b> ({band.min}–{band.max}): {band.meaning} <em>{band.action}</em>
            </div>
          </div>
        </details>
      </div>
      <div className="scoreR"><b>{pct}</b>/100</div>
    </div>
  );
}
