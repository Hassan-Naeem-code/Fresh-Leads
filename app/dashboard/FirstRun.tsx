"use client";

import { Search, Flame, Phone, Mail, Lightbulb, Check, ArrowRight } from "../icons";
import { playbookById, type PlaybookId } from "@/lib/playbooks";

// What a brand new account sees instead of a blank search box.
//
// The problem this solves is measured against the competition rather than invented:
// a trial that opens on an empty field makes the customer do work before the product
// has proved anything, and the ones they are comparing us against hand over a
// pre-built list. Three free credits are worth nothing if nobody knows what to type.
//
// So this does two things and no more. It shows one real lead in full, so the shape
// of the output is understood before any credit is spent, and it offers one click
// that runs a sensible first search for whatever they told us they sell.

/** A real lead, from a real search, with the business anonymised. */
const EXAMPLE = {
  name: "A dental practice in your area",
  grade: 68,
  tier: "HOT",
  signals: ["Website down / unreachable", "No online booking", "Phone number listed"],
  pitch: "Their site has been unreachable since 30 July. Lead with that and offer to have them back online this week.",
  owner: "Sarah B., practice owner",
  since: "30 July",
};

export function FirstRun({
  playbook,
  onRunExample,
  busy,
}: {
  playbook: PlaybookId;
  onRunExample: (niche: string, location: string) => void;
  busy: boolean;
}) {
  const book = playbookById(playbook);
  // Their own playbook decides the suggestion, so the first search is one they would
  // plausibly have run themselves rather than a demo of somebody else's business.
  const niche = book.niches[0] ?? "restaurants";

  return (
    <div className="firstrun">
      <div className="frintro">
        <span className="pill"><Flame size={13} /> Start here</span>
        <h2>This is what one lead looks like.</h2>
        <p className="muted">
          Every lead arrives graded, with the reason for the grade and something to say on
          the call. Searching is free. A credit is only spent when you decide to open one.
        </p>
      </div>

      <div className="frexample">
        <div className="frcard">
          <div className="frcardtop">
            <div>
              <b>{EXAMPLE.name}</b>
              <span className="muted sm">Example, from a real search</span>
            </div>
            <span className="frtier">{EXAMPLE.tier} {EXAMPLE.grade}/100</span>
          </div>

          <div className="frsignals">
            {EXAMPLE.signals.map((s) => (
              <span key={s} className={`sig ${/no |down/i.test(s) ? "bad" : ""}`}>{s}</span>
            ))}
          </div>

          <div className="frrow"><Phone size={14} /> Phone checked, it rings</div>
          <div className="frrow"><Mail size={14} /> Mailbox checked, it accepts</div>
          <div className="frrow"><Check size={14} /> {EXAMPLE.owner}</div>
          <div className="frrow hot"><Flame size={14} /> Site went down, since {EXAMPLE.since}</div>

          <div className="frpitch">
            <Lightbulb size={14} />
            <span>{EXAMPLE.pitch}</span>
          </div>
        </div>

        <ol className="frsteps">
          <li>
            <b>Search for nothing</b>
            <span>Type a trade and a town, or describe your ideal customer in a sentence. It costs no credits and you can run as many as you like.</span>
          </li>
          <li>
            <b>Read the grades</b>
            <span>Everything is scored against what you sell, so the top of the list is where your pitch actually lands.</span>
          </li>
          <li>
            <b>Open the ones worth calling</b>
            <span>One credit each, yours permanently. Re-reading, exporting and pushing to your CRM never cost anything again.</span>
          </li>
        </ol>
      </div>

      <div className="frcta">
        <button
          className="go accent"
          disabled={busy}
          onClick={() => onRunExample(niche, "Austin, TX")}
        >
          <Search size={16} /> {busy ? "Searching..." : `Try it: ${niche} in Austin`}
        </button>
        <span className="muted sm">
          Or type your own above. Either way this costs nothing.
        </span>
      </div>
    </div>
  );
}
