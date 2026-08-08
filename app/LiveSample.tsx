"use client";

import { useState } from "react";
import Link from "next/link";
import type { SampleLead } from "@/lib/sample";
import { Search, Check, Dot, ArrowRight, AlertTriangle, GlobeOff } from "./icons";

// THE HERO, RUNNING FOR REAL.
//
// It starts as the static mock, because a landing page has to look like something
// before the visitor has typed anything and a spinner is not a hero. The moment they
// search, every row on screen is a real business they can look up.
//
// WHY THIS IS THE MOST VALUABLE THING ON THE PAGE. Every competitor writes "verified
// leads" on their home page. The word is free. What is not free is showing three real
// businesses in the visitor's own city, graded, with the freshness stated, before they
// have given us an email address. A vendor whose data is bad cannot do this, which is
// exactly why doing it is persuasive.
//
// WHAT IT DOES NOT SHOW: phone, email, or the findings behind the grade. Those are the
// product. The redaction happens server-side in lib/sample.ts against the same
// definition used for a locked lead inside the app, so nothing here can widen it.

const EXAMPLES = [
  { niche: "dentists", location: "Austin, TX" },
  { niche: "coffee shops", location: "Portland, OR" },
  { niche: "plumbers", location: "Tampa, FL" },
];

type State =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; leads: SampleLead[]; area: string; found: number; niche: string }
  | { kind: "empty"; message: string };

export function LiveSample({ mock }: { mock: React.ReactNode }) {
  const [niche, setNiche] = useState("");
  const [location, setLocation] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function run(n: string, l: string) {
    if (!n.trim() || !l.trim()) return;
    setNiche(n);
    setLocation(l);
    setState({ kind: "running" });
    try {
      const res = await fetch("/api/sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche: n, location: l }),
      });
      const data = await res.json().catch(() => null);
      if (!data) throw new Error("no response");
      if (data.error) {
        setState({ kind: "empty", message: data.error });
        return;
      }
      setState({
        kind: "done",
        leads: data.leads ?? [],
        area: data.area ?? l,
        found: data.found ?? 0,
        niche: data.niche ?? n,
      });
    } catch {
      setState({
        kind: "empty",
        message: "That search did not finish. Please try again.",
      });
    }
  }

  return (
    <div className="ls">
      <form
        className="ls-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(niche, location);
        }}
      >
        <div className="ls-fields">
          <input
            className="ls-input"
            placeholder="dentists"
            aria-label="Business type"
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            maxLength={80}
          />
          <span className="ls-in">in</span>
          <input
            className="ls-input"
            placeholder="Austin, TX"
            aria-label="City"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={80}
          />
          <button className="go accent" type="submit" disabled={state.kind === "running"}>
            {state.kind === "running" ? "Searching..." : <>Try it <Search size={15} /></>}
          </button>
        </div>
        {/* No account, no card, said before they have to wonder. */}
        <span className="ls-note">
          A real search, run now. No sign up, no card.
        </span>
      </form>

      {state.kind === "idle" && (
        <>
          <div className="ls-examples">
            <span>Or try</span>
            {EXAMPLES.map((e) => (
              <button
                key={e.niche}
                type="button"
                className="ls-example"
                onClick={() => void run(e.niche, e.location)}
              >
                {e.niche} in {e.location}
              </button>
            ))}
          </div>
          {/* The static mock, until there is something real to put in its place. */}
          {mock}
        </>
      )}

      {state.kind === "running" && (
        <div className="ls-panel running">
          <div className="ls-bar">
            <span className="mock-dots"><i /><i /><i /></span>
            <div className="mock-search">
              <Search size={14} />
              <span>{niche} · {location}</span>
            </div>
            <span className="mock-live"><i />live</span>
          </div>
          {/* Says what is actually happening. These are the real stages in
              lib/sample.ts, in order, so the wait explains the product. */}
          <div className="ls-steps">
            <span>Finding businesses…</span>
            <span>Reading their websites…</span>
            <span>Checking contact details…</span>
            <span>Grading and ranking…</span>
          </div>
        </div>
      )}

      {state.kind === "empty" && (
        <div className="ls-panel">
          <div className="ls-empty">
            <AlertTriangle size={18} />
            <p>{state.message}</p>
            <button type="button" className="linkish" onClick={() => setState({ kind: "idle" })}>
              Try another search
            </button>
          </div>
        </div>
      )}

      {state.kind === "done" && (
        <div className="ls-panel">
          <div className="ls-bar">
            <span className="mock-dots"><i /><i /><i /></span>
            <div className="mock-search">
              <Search size={14} />
              <span>{state.niche} · {state.area}</span>
            </div>
            <span className="mock-live"><i />live</span>
          </div>

          <div className="ls-body">
            <div className="ls-found">
              {/* Says exactly what was done. Not "the top three", which would be a
                  claim about ranking we are deliberately not making here. */}
              Found <b>{state.found}</b> {state.niche} in {state.area}. Here are{" "}
              {state.leads.length} we checked, graded on what we found.
            </div>

            {state.leads.map((l) => (
              <div className="ls-lead" key={l.name}>
                {/* THE TIER, WITHOUT THE PERCENTAGE.
                    Inside the product the grade is a share of what was ATTAINABLE for
                    that lead, so a business we could learn little about scores high on
                    a low ceiling: the first real run of this endpoint showed a WARM
                    lead at 100 ranked below a HOT one at 73, which is correct and
                    looks broken. Explaining it needs a paragraph the hero cannot
                    carry, and a number that appears to contradict itself costs more
                    trust than it buys. The tier already says what matters. */}
                <div className={`mock-badge ${l.tier} tieronly`}>
                  <small>{l.tier}</small>
                </div>
                <div className="ls-leadbody">
                  <b>{l.name}</b>
                  <span className="ls-cat">
                    {l.category}{l.city ? ` · ${l.city}` : ""}
                    {/* One phrase, not two. The label already reads "checked today"
                        when it is our own crawl, so prefixing "Checked by us" produced
                        "Checked by us · checked today" on every row. */}
                    <span className={`fresh ${l.currencyIsOurCheck ? "CHECKED" : ""}`}>
                      <Dot />{" "}
                      {l.currencyIsOurCheck
                        ? `We ${l.currencyLabel}`
                        : `Their ${l.currencyLabel}`}
                    </span>
                  </span>
                  <span className="ls-tags">
                    {l.deliverable && (
                      <span className="vbadge good"><Check size={11} /> Contact found</span>
                    )}
                    {!l.hasWebsite && (
                      <span className="vbadge"><GlobeOff size={11} /> No website</span>
                    )}
                    {l.signalCount > 0 && (
                      <span className="vbadge">
                        {l.signalCount} finding{l.signalCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            ))}

            <div className="ls-cta">
              <span>
                Contact details, the owner&rsquo;s name and every finding are behind the
                unlock. Three credits free, no card.
              </span>
              <Link href="/signup" className="pr-btn primary sm">
                Get the contacts <ArrowRight size={14} />
              </Link>
            </div>
          </div>

          <button type="button" className="ls-again linkish" onClick={() => setState({ kind: "idle" })}>
            Search somewhere else
          </button>
        </div>
      )}
    </div>
  );
}
