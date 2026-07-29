"use client";

import { useState } from "react";
import { playbookById, type PlaybookId } from "@/lib/playbooks";
import { Search, ArrowRight, AlertTriangle, Check } from "../icons";

export type IcpResult = {
  playbook: PlaybookId;
  sells: string;
  targets: string[];
  location: string;
  niche: string;
  ai: boolean;
  missing: string[];
};

const MISSING_LABEL: Record<string, string> = {
  sells: "what you sell",
  targets: "which business types you want",
  location: "which city or area",
};

/**
 * "Describe your ideal customer" — one box instead of a form.
 *
 * It writes exactly the same fields the playbook picker does (see /api/profile), so
 * the two are interchangeable rather than parallel paths. Whatever it can't work out
 * it says so rather than guessing: inventing a city would silently search the wrong
 * market and the user would never know why the leads looked wrong.
 */
export function IcpBox({
  onApply,
  aiParsing,
}: {
  onApply: (icp: IcpResult) => void;
  /** Claude-backed parsing is configured; otherwise a keyword parser is used. */
  aiParsing: boolean;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<IcpResult | null>(null);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ describe: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not read that");
      setResult(data.parsed);
      onApply(data.parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="icpbox">
      <form onSubmit={submit}>
        <label className="icp-label">Describe your ideal customer</label>
        <div className="icp-row">
          <textarea
            className="icp-input"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. I sell Shift4 card processing terminals to restaurants and bars in Warren, MI"
          />
          <button className="go accent" disabled={busy || !text.trim()}>
            {busy ? "Reading…" : "Set up"}
            <ArrowRight size={15} />
          </button>
        </div>
        <span className="icp-hint">
          <Search size={12} /> One sentence is enough. We&rsquo;ll work out what you sell, who to
          target, and where.
          {!aiParsing && " (Basic matching for now.)"}
        </span>
        {/* `aiParsing` only says a key is CONFIGURED. `result.ai` says the AI call
            actually succeeded. When they disagree — an expired key, no API credit, a
            timeout — say so, because otherwise the box silently drops to keyword
            matching while still looking like it read the sentence properly. */}
        {aiParsing && result && !result.ai && (
          <span className="icp-hint warn">
            <AlertTriangle size={12} /> Read with basic keyword matching — the AI parser
            didn&rsquo;t respond. Check the Claude API key and its credit balance.
          </span>
        )}
      </form>

      {error && (
        <div className="status error">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {result && (
        <div className="icp-result">
          <span className="icp-chip">
            <Check size={12} /> Selling: <b>{playbookById(result.playbook).label}</b>
          </span>
          {result.targets.length > 0 && (
            <span className="icp-chip">
              Targeting: <b>{result.targets.join(", ")}</b>
            </span>
          )}
          {result.location && (
            <span className="icp-chip">
              In: <b>{result.location}</b>
            </span>
          )}
          {result.missing.length > 0 && (
            <span className="icp-chip warn">
              Still need {result.missing.map((m) => MISSING_LABEL[m] ?? m).join(" and ")} — fill it in
              below.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
