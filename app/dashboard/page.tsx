"use client";
import { useEffect, useMemo, useState } from "react";
import type { Lead, LockedLead, ResultLead, SearchResult, UnlockedLead } from "@/lib/types";
import { LeadCard } from "../LeadCard";
import { LockedLeadCard } from "./LockedLeadCard";
import { LeadModal } from "./LeadModal";
import { CheckoutReturn } from "./CheckoutReturn";
import { IcpBox, type IcpResult } from "./IcpBox";
import { CreditToast, type BlockReason } from "./CreditToast";
import { setCredits, useCredits } from "./credit-store";
import type { Watchlist } from "@/lib/watchlists";
import { PROBLEMS, problemById } from "@/lib/problems";
import { PLAYBOOKS, DEFAULT_PLAYBOOK, playbookById, playbookFactors, type PlaybookId } from "@/lib/playbooks";
import { GRADE_SCALE, FACTOR_CATALOG, MAX_ATTAINABLE, LEGACY_ATTAINABLE, TIER_RANK, bandFor, gradePct } from "@/lib/score";
import { FirstRun } from "./FirstRun";
import {
  FRESHNESS_SCALE,
  bandFor as freshnessBandFor,
  relativeAge,
  ageInDays,
  type FreshnessLevel,
} from "@/lib/freshness";
import {
  Phone, Mail, Globe, GlobeOff, MapPin, Lightbulb, Download, Info, AlertTriangle, Clock, Flame, Gauge, Building, Search, ChevronDown, ChevronRight, ArrowRight, RotateCcw, Dot, Check, Coin, Plus, X, Lock,
} from "../icons";



// The user-facing 0-100 grade: raw points as a share of what was attainable for
// that lead. Raw point totals are NOT comparable between leads, because a lead we
// could run more checks on has a bigger ceiling, so every comparison, filter, sort
// and export goes through this.
const grade = (l: ResultLead) => gradePct(l.score, l.scoreMax || LEGACY_ATTAINABLE);

type SortKey = "score" | "freshest" | "name";

const ALL_TIERS: Lead["tier"][] = ["HOT", "WARM", "COOL"];
const ALL_FRESHNESS: FreshnessLevel[] = ["FRESH", "RECENT", "AGING", "STALE", "UNKNOWN"];

export default function Home() {
  // Empty by design. Prefilling a niche and a city assumes what this customer sells
  // and where they sell it, which is the one thing we should be asking rather than
  // guessing. A returning account has these restored from its saved buyer profile.
  const [niche, setNiche] = useState("");
  const [location, setLocation] = useState("");
  const [limit, setLimit] = useState(40);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showScale, setShowScale] = useState(false);

  // Unlock flow. `open` is the lead shown in the dialog, `unlocking` is the id of
  // the card whose button is spinning, `justUnlocked` drives the "1 credit spent"
  // confirmation so a user always sees what their credit bought.
  const [open, setOpen] = useState<UnlockedLead | null>(null);
  const [justUnlocked, setJustUnlocked] = useState(false);
  const [unlocking, setUnlocking] = useState<string | null>(null);
  // Which format is in flight, so only the button that was pressed shows a spinner.
  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);
  // Which purchase the last blocked action needs, so the prompt is specific.
  const [needsPurchase, setNeedsPurchase] = useState<"subscription" | "credits" | null>(null);
  // dbIds paid for during this session via export, so their cards stop advertising
  // a charge that would not happen.
  const [paidIds, setPaidIds] = useState<Set<string>>(new Set());
  // Markets this account is watching. The reason to come back next week.
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [activeWatchlist, setActiveWatchlist] = useState<string | null>(null);
  const [savingWatch, setSavingWatch] = useState(false);
  // Drives the PDF button. The server enforces the same rule, so a stale value here
  // can only ever cost a wasted click, never leak the feature.
  const [subscribed, setSubscribed] = useState(false);
  // Ideal-customer bars, the size and quality filters every competitor offers.
  // Applied server-side, so they select from everything found rather than the page.
  const [minRating, setMinRating] = useState(0);
  const [minReviews, setMinReviews] = useState(0);
  const [webPresence, setWebPresence] = useState<"any" | "none" | "social_only" | "has_site">("any");
  // What the toast is announcing, or null when there is nothing to say.
  const [toast, setToast] = useState<BlockReason | null>(null);
  // So the "you have run out" toast fires once per exhaustion, not on every render.
  const [warnedAtZero, setWarnedAtZero] = useState(false);
  // null until seeded. Compared with ?? so a real zero is never treated as unknown.
  const credits = useCredits() ?? 0;

  // --- filters ---
  const [minScore, setMinScore] = useState(0);
  const [tiers, setTiers] = useState<Set<string>>(new Set(ALL_TIERS));
  const [freshLevels, setFreshLevels] = useState<Set<string>>(new Set(ALL_FRESHNESS));
  const [reqFactors, setReqFactors] = useState<Set<string>>(new Set());
  const [problem, setProblem] = useState("any");
  // WHAT THE USER SELLS. This decides which signals are scored and shown at all: a
  // card-terminal reseller should never be shown "no HTTPS", and a web designer should
  // never be shown which POS a restaurant runs.
  const [playbook, setPlaybook] = useState<PlaybookId>(DEFAULT_PLAYBOOK);
  // AI-backed ICP parsing is only available when an API key is configured; the
  // box still works without one, using keyword matching.
  const [aiParsing, setAiParsing] = useState(false);

  // Restore what the user sells. Without this the playbook resets to the default on
  // every reload, which silently re-grades their leads for the wrong buyer.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/profile");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setAiParsing(Boolean(data.aiParsing));
        if (data.profile?.playbook) setPlaybook(data.profile.playbook);
        if (data.profile?.targets?.[0]) setNiche(data.profile.targets[0]);
        if (data.profile?.location) setLocation(data.profile.location);
        // The qualifying requirements, restored with everything else. Without this a
        // reload kept the niche and the playbook but silently dropped the criteria, so
        // the next search widened back to the whole category with nothing on screen
        // saying so, which is the exact failure the saved profile exists to prevent.
        if (data.profile?.targets?.length) setIcpTargets(data.profile.targets);
        if (data.profile?.criteria?.length) setIcpCriteria(data.profile.criteria);
        if (data.profile?.excludes?.length) setIcpExcludes(data.profile.excludes);
      } catch {
        // A profile we can't load just means defaults; never block the dashboard.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The qualitative half of a parsed ICP, kept so every later search on this screen
   * still honours it.
   *
   * Held in state rather than passed once, because the buyer changes the playbook or
   * pages through results after describing their ideal customer, and their
   * requirements do not stop applying because they clicked something.
   */
  const [icpCriteria, setIcpCriteria] = useState<string[]>([]);
  const [icpExcludes, setIcpExcludes] = useState<string[]>([]);
  const [icpTargets, setIcpTargets] = useState<string[]>([]);

  /** Apply a parsed ICP: set the fields, then search if it gave us enough. */
  function applyIcp(icp: IcpResult) {
    setPlaybook(icp.playbook);
    setProblem("any");
    if (icp.niche) setNiche(icp.niche);
    if (icp.location) setLocation(icp.location);
    const criteria = icp.criteria ?? [];
    const excludes = icp.excludes ?? [];
    const targets = icp.targets ?? [];
    setIcpCriteria(criteria);
    setIcpExcludes(excludes);
    setIcpTargets(targets);
    if (icp.niche && icp.location) {
      // Passed explicitly as well as set: this runs in the same tick, so the state
      // above has not applied yet and run() would send the previous description's
      // requirements with this description's niche.
      void run(undefined, {
        playbook: icp.playbook, problem: "any", niche: icp.niche, location: icp.location,
        criteria, excludes, targets,
      });
    }
  }
  const [genuineOnly, setGenuineOnly] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("score");

  function toggle(set: Set<string>, apply: (s: Set<string>) => void, key: string) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    apply(next);
  }

  // Filters that only narrow what is already on screen.
  function resetClientFilters() {
    setMinScore(0);
    setTiers(new Set(ALL_TIERS));
    setFreshLevels(new Set(ALL_FRESHNESS));
    setGenuineOnly(false);
    setQ("");
    setSort("score");
  }

  // Everything, including the filters that are part of the server query.
  function resetFilters() {
    resetClientFilters();
    setReqFactors(new Set());
    setProblem("any");
  }

  // `overrides` exists because a problem chip both sets state AND re-runs the
  // search: reading `problem` here would still see the previous value, since React
  // has not applied the update yet.
  async function loadWatchlists() {
    try {
      const res = await fetch("/api/watchlists");
      if (res.ok) setWatchlists((await res.json()).watchlists ?? []);
    } catch {
      // A watchlist strip that fails to load must not break the search page.
    }
  }

  // The balance reaching zero is the moment the customer needs telling, so it is
  // watched directly rather than being announced only by whichever action failed.
  useEffect(() => {
    if (credits > 0) {
      setWarnedAtZero(false);
      return;
    }
    if (warnedAtZero) return;
    setWarnedAtZero(true);
    // A trial account cannot buy credits until it subscribes, so the prompt has to be
    // the yearly plan first. See lib/access.ts canBuyCredits.
    setToast(subscribed ? "credits" : "subscription");
  }, [credits, subscribed, warnedAtZero]);

  useEffect(() => {
    loadWatchlists();
    fetch("/api/billing/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d.subscribed === "boolean") setSubscribed(d.subscribed); })
      .catch(() => {});
  }, []);

  /** Save the search on screen as a market to watch. */
  async function saveWatchlist() {
    setSavingWatch(true);
    try {
      const res = await fetch("/api/watchlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche, location, playbook, problem }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not save that watchlist.");
        return;
      }
      setWatchlists((w) => [data.watchlist, ...w]);
      setActiveWatchlist(data.watchlist.id);
    } finally {
      setSavingWatch(false);
    }
  }

  async function removeWatchlist(id: string) {
    await fetch(`/api/watchlists?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setWatchlists((w) => w.filter((x) => x.id !== id));
    if (activeWatchlist === id) setActiveWatchlist(null);
  }

  /** Re-run a watched market and show what is new since last time. */
  function openWatchlist(w: Watchlist) {
    setNiche(w.niche);
    setLocation(w.location);
    setActiveWatchlist(w.id);
    if (w.problem) setProblem(w.problem);
    run(undefined, {
      niche: w.niche,
      location: w.location,
      problem: w.problem ?? "any",
      playbook: (w.playbook as PlaybookId) ?? playbook,
      watchlistId: w.id,
    });
  }

  async function run(
    e?: React.FormEvent,
    overrides?: {
      problem?: string; playbook?: PlaybookId; niche?: string; location?: string;
      watchlistId?: string | null;
      minRating?: number; minReviews?: number;
      webPresence?: "any" | "none" | "social_only" | "has_site";
      /** Where in the ranking to start. Set only by Load more. */
      offset?: number;
      /** ICP requirements, passed explicitly when they were parsed in this same tick. */
      criteria?: string[];
      excludes?: string[];
      targets?: string[];
    }
  ) {
    e?.preventDefault();
    // Paging APPENDS. Everything else replaces, including clearing the old results
    // first, so a slow search cannot leave the previous answer on screen looking like
    // the new one.
    const paging = (overrides?.offset ?? 0) > 0;
    const activeProblem = overrides?.problem ?? problem;
    const activePlaybook = overrides?.playbook ?? playbook;
    const activeNiche = overrides?.niche ?? niche;
    const activeLocation = overrides?.location ?? location;
    // Explicitly passed on a watchlist click, because React state is not applied yet
    // at the moment the handler runs.
    const activeWatch = overrides?.watchlistId !== undefined ? overrides.watchlistId : activeWatchlist;
    if (paging) setLoadingMore(true);
    else setLoading(true);
    setError("");
    if (!paging) setResult(null);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The problem filter runs server-side: a locked lead never ships its need
        // signals to the browser, so the client cannot filter on them.
        body: JSON.stringify({
          niche: activeNiche,
          location: activeLocation,
          limit,
          problem: activeProblem,
          requiredFactors: [...reqFactors],
          playbook: activePlaybook,
          watchlistId: activeWatch ?? undefined,
          // Explicit overrides, because a chip click runs before React state applies.
          minRating: overrides?.minRating ?? minRating,
          minReviews: overrides?.minReviews ?? minReviews,
          webPresence: overrides?.webPresence ?? webPresence,
          offset: overrides?.offset ?? 0,
          // The half of "describe your ideal customer" that used to be parsed and
          // dropped. Ranking and the exclusion filter both run on these server-side,
          // for the same reason the problem filter does: a locked lead ships none of
          // the evidence they are decided from.
          criteria: overrides?.criteria ?? icpCriteria,
          excludes: overrides?.excludes ?? icpExcludes,
          targets: overrides?.targets ?? icpTargets,
        }),
      });
      // Read as TEXT first, then parse.
      //
      // A platform level failure (a timeout, a cold start that died, a 502 from the
      // edge) answers with plain prose, not JSON, and res.json() throws on it. The
      // customer then saw "Unexpected token 'A', \"An error o\"... is not valid JSON",
      // which tells them nothing and reads like the site is broken beyond use.
      const raw = await res.text();
      // Deliberately loose: this is a parsed response, and the branches below narrow
      // it themselves. A stricter type here buys nothing and fights every use.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any;
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        setError(
          res.status === 504 || /timed? ?out/i.test(raw)
            ? "That search took too long and was cut off. Try a smaller area, or ask for fewer results."
            : "Something went wrong on our side and the search did not finish. Nothing was charged. Try again in a moment."
        );
        setLoading(false);
        setLoadingMore(false);
        return;
      }

      if (res.ok && activeWatch) loadWatchlists();
      if (!res.ok) {
        if (typeof data.credits === "number") setCredits(data.credits);
        // 402 means a purchase is needed. Which one depends on what is missing: the
        // yearly access fee, or credits. Sending someone to buy credits when their
        // access has lapsed would sell them something they still could not use.
        if (data.code === "subscription_required" || data.code === "credits_required") {
          const why = data.code === "subscription_required" ? "subscription" : "credits";
          setNeedsPurchase(why);
          setToast(why);
        }
        throw new Error(data.error || "Search failed");
      }
      setNeedsPurchase(null);
      if (paging) {
        // Page two is a separate request that re-ranks from scratch, so identical ties
        // could in principle come back twice. De-duplicated on the way in rather than
        // trusted, because a lead shown twice reads as a billing bug.
        setResult((prev) => {
          if (!prev) return data;
          const seen = new Set(prev.leads.map((l) => l.id));
          const fresh = (data.leads ?? []).filter((l: { id: string }) => !seen.has(l.id));
          return {
            ...data,
            leads: [...prev.leads, ...fresh],
            count: prev.leads.length + fresh.length,
            // Keep the notes from the FIRST page: they describe the search, not the
            // slice, and appending them again would repeat the same sentences.
            notes: prev.notes,
          };
        });
      } else {
        setResult(data);
      }
      if (typeof data.credits === "number") setCredits(data.credits);
      // Client-side filters reset, but NOT the problem/factor choice: those were
      // part of the query the server just answered, so clearing them would
      // misdescribe the results on screen.
      if (!paging) resetClientFilters();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  // Filters run client-side over the fetched result set, so they're instant.
  const visible = useMemo(() => {
    if (!result) return [];
    const needle = q.trim().toLowerCase();
    const out = result.leads.filter((l) => {
      if (grade(l) < minScore) return false;
      if (genuineOnly && !l.deliverable) return false;
      if (!tiers.has(l.tier)) return false;
      if (!freshLevels.has(l.freshness)) return false;
      // The problem / factor filters are NOT applied here: the server already
      // applied them to build this result set.
      if (needle && !`${l.name} ${l.category} ${l.city}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    out.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "freshest") {
        const av = a.freshnessAgeDays ?? Number.MAX_SAFE_INTEGER;
        const bv = b.freshnessAgeDays ?? Number.MAX_SAFE_INTEGER;
        return av - bv || TIER_RANK[b.tier] - TIER_RANK[a.tier] || grade(b) - grade(a);
      }
      // Tier before percentage: a lead with no evidence saturates its own small
      // ceiling at 100% and would otherwise sit above a genuinely Hot lead.
      return TIER_RANK[b.tier] - TIER_RANK[a.tier] || grade(b) - grade(a);
    });
    return out;
  }, [result, minScore, tiers, freshLevels, genuineOnly, q, sort]);

  /**
   * Unlock one lead. The server decides what it costs and what comes back; this only
   * reflects the answer. A lead already paid for returns "already" and is free.
   */
  async function unlock(lead: LockedLead) {
    if (!lead.dbId) {
      setError("This search could not be saved, please run it again to unlock leads.");
      return;
    }
    setUnlocking(lead.id);
    setError("");
    try {
      const res = await fetch("/api/leads/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.dbId }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "insufficient_credits") {
          setCredits(data.credits ?? 0);
          setToast(subscribed ? "credits" : "subscription");
        }
        // The server just dialled the number and checked the mailbox, found both dead,
        // and charged nothing. Correct the card so it stops claiming a contact we now
        // know is gone, and forget any stale "already yours" marker on it.
        if (data.code === "unverifiable") {
          setResult((prev) =>
            prev
              ? {
                  ...prev,
                  leads: prev.leads.map((l) =>
                    l.id === lead.id ? { ...l, deliverable: false } : l
                  ),
                }
              : prev
          );
          setPaidIds((prev) => {
            const next = new Set(prev);
            if (lead.dbId) next.delete(lead.dbId);
            return next;
          });
        }
        throw new Error(data.error || "Could not unlock this lead");
      }
      setCredits(data.credits ?? 0);
      // Swap the teaser for the full record, so it stays open afterwards.
      setResult((prev) =>
        prev
          ? { ...prev, leads: prev.leads.map((l) => (l.id === lead.id ? data.lead : l)) }
          : prev
      );
      setJustUnlocked(data.status === "unlocked");
      setOpen(data.lead);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlock this lead");
    } finally {
      setUnlocking(null);
    }
  }

  /**
   * Export what is on screen. One credit per lead, and leads already unlocked cost
   * nothing. The CSV is built server-side, because the rows contain the contact
   * details that the credits pay for.
   */
  async function exportLeads(format: "csv" | "pdf" = "csv") {
    if (!visible.length) return;
    const ids = visible.map((l) => l.dbId).filter((id): id is string => Boolean(id));
    if (!ids.length) {
      setError("These leads were not saved, please run the search again to export.");
      return;
    }
    setExporting(format);
    setError("");
    try {
      const res = await fetch("/api/leads/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: ids, format }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (typeof data.credits === "number") setCredits(data.credits);
        throw new Error(data.error || "Export failed");
      }

      const remaining = res.headers.get("X-Credits-Remaining");
      if (remaining !== null) setCredits(Number(remaining));

      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `leads_${niche}_${location}`.replace(/[^a-z0-9]+/gi, "_") + (format === "pdf" ? ".pdf" : ".csv");
      a.click();
      URL.revokeObjectURL(a.href);

      // Everything in that file is now paid for. We don't have the full records
      // here (the CSV was built server-side), so remember which ones are already
      // owned: their cards then offer "View" instead of asking for a credit again.
      setPaidIds((prev) => new Set([...prev, ...ids]));

      // Leads whose phone and mailbox both turned out to be dead are left out of the
      // file and out of the charge. Say so, rather than letting the user count the rows
      // and wonder. (A skipped lead may briefly show as owned here; opening it returns
      // the same "not charged" answer from the server, which corrects the card.)
      const skipped = Number(res.headers.get("X-Leads-Skipped") ?? 0);
      if (skipped > 0) {
        setError(
          `${skipped} lead${skipped === 1 ? "" : "s"} failed live verification and ` +
            `${skipped === 1 ? "was" : "were"} left out of the file. You weren't charged for ${skipped === 1 ? "it" : "them"}.`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(null);
    }
  }

  /** How many of the visible leads still need paying for. */
  const lockedVisible = visible.filter((l) => l.locked).length;

  const hot = visible.filter((l) => l.tier === "HOT").length;
  const warm = visible.filter((l) => l.tier === "WARM").length;
  const freshCount = visible.filter((l) => l.freshness === "FRESH" || l.freshness === "RECENT").length;
  const genuineCount = visible.filter((l) => l.deliverable).length;
  const filtersOn =
    minScore > 0 || tiers.size < 3 || freshLevels.size < ALL_FRESHNESS.length ||
    reqFactors.size > 0 || genuineOnly || q.trim() !== "" || problem !== "any";

  const scanAge = result ? relativeAge(ageInDays(result.scannedAt)) : "";

  return (
    <div className="wrap">
      {/* Confirms a Stripe return and waits for the webhook to land. */}
      <CheckoutReturn />

      <div className="app-head">
        <span className="app-eyebrow"><Dot size={13} /> Live search</span>
        <h1>Find businesses that need you.</h1>
        <p>
          Type any niche and location. We pull real businesses, audit every web presence live,
          and grade them so you only call the ones worth calling.
        </p>
      </div>

      {/* The one-box front door. Writes the same fields as the picker below. */}
      <IcpBox aiParsing={aiParsing} onApply={applyIcp} />

      {/* ACTIVE REQUIREMENTS, SHOWN BECAUSE THEY ARE ACTIVE.
          Persisting the criteria (migration 034) fixed one silent failure and created
          another: restored from the profile on load, they narrow and re-rank every
          later search while the box that captured them sits empty. A filter the user
          cannot see is a filter they will read as a broken search. So they are listed
          whenever they apply, with one click to drop them. */}
      {(icpCriteria.length > 0 || icpExcludes.length > 0) && (
        <div className="icpactive">
          <span className="icpactive-label">Screening every search for</span>
          {icpCriteria.map((c) => (
            <span className="icpactive-chip" key={c}>{c}</span>
          ))}
          {icpExcludes.map((c) => (
            <span className="icpactive-chip out" key={c}>not {c}</span>
          ))}
          <button
            type="button"
            className="linkish"
            onClick={() => {
              setIcpCriteria([]);
              setIcpExcludes([]);
              setIcpTargets([]);
              // Cleared in the database too, or the next reload brings them back and
              // the button looks broken.
              void fetch("/api/profile", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ criteria: [], excludes: [] }),
              }).catch(() => {});
            }}
          >
            Clear
          </button>
        </div>
      )}

      {/* WHAT DO YOU SELL. Asked before anything else, because it decides what a good
          lead even means: two sellers looking at the same business should get
          different grades and different reasons. */}
      <div className="problem-picker">
        <span className="problem-label">What do you sell?</span>
        <div className="problem-chips">
          {PLAYBOOKS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`problem-chip ${playbook === p.id ? "on" : ""}`}
              title={p.blurb}
              onClick={() => {
                setPlaybook(p.id);
                // Remember it: this is the most important fact about the user.
                void fetch("/api/profile", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ playbook: p.id }),
                });
                // Chips from the old playbook may not exist in the new one.
                if (!playbookById(p.id).problems.includes(problem)) setProblem("any");
                // Re-query: the server grades against this.
                if (result) void run(undefined, { playbook: p.id, problem: "any" });
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="problem-hint">
          {playbookById(playbook).blurb} A high grade here means:{" "}
          <b>{playbookById(playbook).meaning}</b>
        </span>
      </div>

      {/* Then search by the specific problem you solve within that */}
      <div className="problem-picker">
        <span className="problem-label">I help local businesses that need…</span>
        <div className="problem-chips">
          {PROBLEMS.filter((p) => playbookById(playbook).problems.includes(p.id)).map((p) => (
            <button
              key={p.id}
              type="button"
              className={`problem-chip ${problem === p.id ? "on" : ""}`}
              onClick={() => {
                setProblem(p.id);
                // Re-query: this filter is applied by the server, not in the browser.
                if (result || loading) void run(undefined, { problem: p.id });
              }}
              title={p.hint}
            >
              {p.label}
            </button>
          ))}
        </div>
        {problem !== "any" && (
          <span className="problem-hint">{PROBLEMS.find((p) => p.id === problem)?.hint}</span>
        )}
      </div>

      <form className="card form" onSubmit={run}>
        <div>
          <label>Business niche</label>
          <input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="Business type, e.g. dentists, salons, auto repair" />
        </div>
        <div>
          <label>Location</label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City or area, e.g. Austin, TX" />
        </div>
        <div>
          <label>Max leads</label>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            <option value={20}>20</option>
            <option value={40}>40</option>
            <option value={60}>60</option>
            <option value={80}>80</option>
            <option value={100}>100</option>
            {/* Above a hundred the audit budget stops covering everything, so the
                response says how many were graded on contact details alone. Offered
                anyway: a wide list you can filter beats a short one you cannot. */}
            <option value={150}>150</option>
            <option value={250}>250</option>
          </select>
        </div>
        <button className="go" disabled={loading || !niche.trim() || !location.trim()}>
          {loading ? "Scanning…" : "Find Leads"}
        </button>
      </form>

      {/* IDEAL CUSTOMER BARS. Size and quality, the filters both Openmart and Apollo
          lead with. Every value here comes from Google Places data we already fetch,
          so none of it costs anything extra to offer. */}
      <div className="icpfilters">
        <div className="icpf">
          <span className="icpf-label">Minimum rating</span>
          <div className="chips tight">
            {[0, 3.5, 4, 4.5].map((v) => (
              <button
                key={v}
                type="button"
                className={`chip toggle ${minRating === v ? "on" : ""}`}
                onClick={() => { setMinRating(v); if (result) run(undefined, { minRating: v }); }}
              >
                {v === 0 ? "Any" : `${v}+`}
              </button>
            ))}
          </div>
        </div>

        <div className="icpf">
          <span className="icpf-label">How busy</span>
          <div className="chips tight">
            {[
              { v: 0, l: "Any" },
              { v: 25, l: "25+ reviews" },
              { v: 100, l: "100+" },
              { v: 500, l: "500+" },
            ].map(({ v, l }) => (
              <button
                key={v}
                type="button"
                className={`chip toggle ${minReviews === v ? "on" : ""}`}
                onClick={() => { setMinReviews(v); if (result) run(undefined, { minReviews: v }); }}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="icpf">
          <span className="icpf-label">Web presence</span>
          <div className="chips tight">
            {[
              { v: "any", l: "Any" },
              { v: "has_site", l: "Has a site" },
              { v: "social_only", l: "Social only" },
              { v: "none", l: "None at all" },
            ].map(({ v, l }) => (
              <button
                key={v}
                type="button"
                className={`chip toggle ${webPresence === v ? "on" : ""}`}
                onClick={() => {
                  const next = v as typeof webPresence;
                  setWebPresence(next);
                  if (result) run(undefined, { webPresence: next });
                }}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* WATCHED MARKETS. The difference between a search box and a service: a saved
          market re-runs and tells you what is new since the last time you looked. */}
      <div className="watchrow">
        <div className="watchchips">
          {watchlists.map((w) => (
            <span key={w.id} className={`watchchip ${activeWatchlist === w.id ? "on" : ""}`}>
              <button type="button" className="watchopen" onClick={() => openWatchlist(w)} title={`${w.niche} in ${w.location}`}>
                {w.name}
                {w.lastRunAt && w.lastNewCount > 0 && <b className="watchnew">{w.lastNewCount} new</b>}
                {!w.lastRunAt && <span className="muted"> not run yet</span>}
              </button>
              <button type="button" className="watchdel" onClick={() => removeWatchlist(w.id)} aria-label={`Stop watching ${w.name}`}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
        <button
          type="button"
          className="watchsave"
          onClick={saveWatchlist}
          disabled={savingWatch || !niche.trim() || !location.trim()}
          title="Watch this market and see what changes"
        >
          <Plus size={13} /> {savingWatch ? "Saving..." : "Watch this market"}
        </button>
      </div>

      <div className="chips">
        {/* Business types this kind of seller usually targets, rather than one generic list. */}
        {playbookById(playbook).niches.map((ex) => (
          <span key={ex} className="chip" onClick={() => setNiche(ex)}>{ex}</span>
        ))}
      </div>

      <GradeScale playbook={playbook} open={showScale} onToggle={() => setShowScale((v) => !v)} />

      {loading && (
        <div className="status"><span className="spinner" /> Geocoding, pulling real businesses and auditing their web presence…</div>
      )}
      {error && <div className="status error"><AlertTriangle size={15} /> {error}</div>}

      {needsPurchase && (
        <div className="creditbar out">
          <span>
            <Coin size={14} />
            {needsPurchase === "subscription"
              ? "Your account needs the $30/year access fee to keep going. Credits are bought separately."
              : "You need at least one credit to search. Credits are $1 each and every lead stays yours for good."}
          </span>
          <a className="go accent sm" href="/dashboard/billing">
            {needsPurchase === "subscription" ? "Get access" : "Buy credits"}
          </a>
        </div>
      )}

      <CreditToast reason={toast} onDismiss={() => setToast(null)} />

      {open && (
        <LeadModal lead={open} justUnlocked={justUnlocked} onClose={() => setOpen(null)} />
      )}

      {/* A brand new account has three credits and no idea what to type. Shown only
          until the first search returns, then never again. */}
      {!result && !loading && !error && (
        <FirstRun
          playbook={playbook}
          busy={loading}
          onRunExample={(exNiche, exLocation) => {
            setNiche(exNiche);
            setLocation(exLocation);
            run(undefined, { niche: exNiche, location: exLocation });
          }}
        />
      )}

      {result && (
        <>
          {/* Standing reminder of what a click costs and what is left. */}
          {lockedVisible > 0 && (
            <div className={`creditbar ${credits <= 0 ? "out" : ""}`}>
              <span>
                <Coin size={14} />
                {credits > 0 ? (
                  <>
                    <b>{credits}</b> credit{credits === 1 ? "" : "s"} left. Each lead you open costs
                    one, and is yours for good.
                  </>
                ) : subscribed ? (
                  <>
                    You&rsquo;re out of credits. Top up to open any of these leads, and to run
                    another search, they stay yours permanently.
                  </>
                ) : (
                  <>
                    Your free credits are used up. The <b>$30 a year</b> plan keeps your account
                    open, and credits are bought separately once you are on it.
                  </>
                )}
              </span>
              <a className="go accent sm" href="/dashboard/billing">
                {credits > 0 ? "Top up" : subscribed ? "Get credits" : "Get access"}
              </a>
            </div>
          )}

          <div className="summary">
            <div className="stat">
              <b>{visible.length}</b>
              <span><Building size={12} /> {filtersOn ? `of ${result.count} shown` : "leads found"}</span>
            </div>
            <div className="stat">
              <b style={{ color: "var(--hot)" }}>{hot}</b>
              <span><Flame size={12} className="i-hot" /> hot</span>
            </div>
            <div className="stat">
              <b style={{ color: "var(--warm)" }}>{warm}</b>
              <span><Flame size={12} className="i-warm" /> warm</span>
            </div>
            <div className="stat">
              <b style={{ color: "var(--cool)" }}>{freshCount}</b>
              <span><Clock size={12} className="i-cool" /> fresh listings</span>
            </div>
            <div className="stat">
              <b style={{ color: "var(--cool)" }}>{genuineCount}</b>
              <span><Check size={12} className="i-cool" /> genuine (verified)</span>
            </div>
            <div className="stat">
              <b style={{ fontSize: 14, fontWeight: 600 }}>{result.matchedTags.join(", ")}</b>
              <span>matched category</span>
            </div>
            <div className="exportgroup">
              <button
                className="ghost exportbtn"
                onClick={() => (subscribed ? exportLeads("csv") : (window.location.href = "/dashboard/billing"))}
                disabled={!visible.length || exporting !== null}
                title={
                  !subscribed
                    ? "Exporting is part of the $30 a year plan"
                    : lockedVisible > 0
                      ? `${lockedVisible} of these ${visible.length} are still locked, so this export costs ${lockedVisible} credit${lockedVisible === 1 ? "" : "s"}`
                      : "Every lead here is already yours, this export is free"
                }
              >
                <Download size={15} />
                {exporting === "csv"
                  ? "Exporting…"
                  : !subscribed
                    ? "CSV (plan only)"
                    : lockedVisible > 0
                      ? `CSV ${visible.length} (${lockedVisible} credit${lockedVisible === 1 ? "" : "s"})`
                      : `CSV ${visible.length} (free)`}
              </button>
              {/* Both formats are part of the plan. The server enforces it; these
                  buttons send somebody to the plan rather than refusing silently,
                  because a disabled control explains nothing. */}
              <button
                className="ghost exportbtn"
                onClick={() => (subscribed ? exportLeads("pdf") : (window.location.href = "/dashboard/billing"))}
                disabled={!visible.length || exporting !== null}
                title={
                  subscribed
                    ? "A printable call sheet: one block per business, number and pitch ready to dial"
                    : "The PDF call sheet is part of the $30/year plan"
                }
              >
                <Download size={15} />
                {exporting === "pdf" ? "Building…" : subscribed ? "PDF call sheet" : "PDF (plan only)"}
              </button>
            </div>
          </div>

          <div className="scanline">
            <Clock size={13} /> Scanned <b>{scanAge}</b> · every website re-audited live at search time
          </div>

          {result.notes.map((n, i) => <div key={i} className="status"><Info size={15} /> {n}</div>)}

          <div className="card filters">
            <div className="frow">
              <div className="fgroup grow">
                <label>Search results</label>
                <div className="inputwrap">
                  <Search size={15} />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, category or city…" />
                </div>
              </div>
              <div className="fgroup">
                <label>Sort by</label>
                <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                  <option value="score">Highest grade</option>
                  <option value="freshest">Freshest listing</option>
                  <option value="name">Name (A-Z)</option>
                </select>
              </div>
              <div className="fgroup">
                <label>Minimum grade: {minScore}</label>
                <input className="range" type="range" min={0} max={100} step={5}
                  value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
              </div>
            </div>

            <div className="frow">
              <div className="fgroup">
                <label>Quality</label>
                <div className="chips tight">
                  <span className={`chip toggle ${genuineOnly ? "on" : ""}`}
                    onClick={() => setGenuineOnly((v) => !v)}
                    title="Only verified, reachable leads at an active business">
                    <Check size={12} /> Genuine only
                  </span>
                </div>
              </div>
              <div className="fgroup">
                <label>Tier</label>
                <div className="chips tight">
                  {ALL_TIERS.map((t) => (
                    <span key={t} className={`chip toggle tdot ${t} ${tiers.has(t) ? "on" : ""}`}
                      onClick={() => toggle(tiers, setTiers, t)}>
                      <Dot /> {bandFor(t).label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="fgroup">
                <label>Freshness</label>
                <div className="chips tight">
                  {ALL_FRESHNESS.map((f) => (
                    <span key={f} className={`chip toggle fdot ${f} ${freshLevels.has(f) ? "on" : ""}`}
                      onClick={() => toggle(freshLevels, setFreshLevels, f)}
                      title={freshnessBandFor(f).meaning}>
                      <Dot /> {freshnessBandFor(f).label}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="frow">
              <div className="fgroup grow">
                <label>Must have these grade factors</label>
                <div className="chips tight">
                  {FACTOR_CATALOG.filter((f) => playbookFactors(playbook).has(f.key)).map((f) => (
                    <span key={f.key} className={`chip toggle ${reqFactors.has(f.key) ? "on" : ""}`}
                      onClick={() => toggle(reqFactors, setReqFactors, f.key)}
                      title={`${f.why} (+${f.points})`}>
                      {f.label} <b className="pts">+{f.points}</b>
                    </span>
                  ))}
                </div>
              </div>
              {filtersOn && (
                <button className="ghost sm" onClick={resetFilters}>
                  <RotateCcw size={14} /> Reset filters
                </button>
              )}
            </div>
          </div>

          <div className="leads">
            {result.leads.length === 0 && <div className="card empty">No businesses found here. Try a broader location or different niche.</div>}
            {result.leads.length > 0 && visible.length === 0 && (
              <div className="card empty">
                No leads match these filters. <button className="linkish" onClick={resetFilters}>Reset filters</button>
              </div>
            )}
            {visible.map((l) =>
              l.locked ? (
                <div key={l.id} className="newwrap">
                  {l.isNew && <span className="newflag">new</span>}
                  <LockedLeadCard
                  lead={l}
                  alreadyPaid={Boolean(l.dbId && paidIds.has(l.dbId))}
                  busy={unlocking === l.id}
                  disabled={unlocking !== null}
                  onUnlock={() => unlock(l)}
                  />
                </div>
              ) : (
                <div key={l.id} className="leadclick newwrap" onClick={() => { setJustUnlocked(false); setOpen(l); }}>
                  {l.isNew && <span className="newflag">new</span>}
                  <LeadCard lead={l} />
                </div>
              )
            )}

            {/* MORE THAN ONE PAGE.
                Discovery routinely finds two to four times what fits in a response;
                the 40 was never what we could find, it was what we could audit inside
                a 60 second function. So the rest is another page rather than a bigger
                one, and the caches make the second page cheap. */}
            {(result.remaining ?? 0) > 0 && visible.length > 0 && (
              <div className="loadmore">
                <button
                  className="ghost"
                  onClick={() => run(undefined, { offset: result.leads.length })}
                  disabled={loadingMore || loading}
                >
                  {loadingMore
                    ? "Checking the next ones..."
                    : `Load ${Math.min(result.remaining ?? 0, limit)} more`}
                </button>
                <span className="muted sm">
                  {result.remaining} more {result.remaining === 1 ? "business" : "businesses"} ranked
                  below these, already found and waiting to be checked.
                </span>
              </div>
            )}

            {/* WHAT THE TRIAL IS NOT SHOWING.
                The server cut these, so this is a statement about a real number
                rather than a blur over content that is quietly still in the payload.
                The blurred cards behind it are decoration, and hold no data at all.

                BELOW the leads, not above them. It used to open the results, so the
                first thing a new account saw after its first search was a price, with
                the three leads it came for pushed under a wall of blur. Ask for the
                money after the product has done something, not instead of it. */}
            {(result.hiddenByPlan ?? 0) > 0 && (
              <div className="planwall">
                <div className="planwallghosts" aria-hidden="true">
                  {Array.from({ length: 3 }, (_, i) => (
                    <div className="planghost" key={i}>
                      <span className="planghostbadge" />
                      <span className="planghostline wide" />
                      <span className="planghostline" />
                    </div>
                  ))}
                </div>
                <div className="planwallcard">
                  <span className="pill"><Lock size={13} /> {result.hiddenByPlan} more found</span>
                  <b>
                    This search found {result.totalFound ?? (result.hiddenByPlan ?? 0) + visible.length}{" "}
                    businesses. Your free credits show the first {visible.length}.
                  </b>
                  <p className="muted sm">
                    The $30 a year plan opens the rest of every search, plus exports, history,
                    email sequences and your CRM. Credits stay $1 each and everything you have
                    already opened stays yours.
                  </p>
                  <a className="go accent" href="/dashboard/billing">
                    See the plan <ArrowRight size={15} />
                  </a>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}


function GradeScale({
  playbook,
  open,
  onToggle,
}: {
  playbook: PlaybookId;
  open: boolean;
  onToggle: () => void;
}) {
  // Only what this buyer is graded on. Listing the full catalog would promise signals
  // their leads are never scored against.
  const active = playbookById(playbook);
  const scored = FACTOR_CATALOG.filter((f) => playbookFactors(playbook).has(f.key));
  const need = scored.filter((f) => f.group === "need");
  const reach = scored.filter((f) => f.group === "reach");

  return (
    <div className="card scale">
      <button className="scalehead" onClick={onToggle} aria-expanded={open}>
        <span className="sh-title">
          <Gauge size={16} /> How the grade works, the scale and every factor behind it
        </span>
        <ChevronDown size={15} className={`caret ${open ? "up" : ""}`} />
      </button>

      {open && (
        <div className="scalebody">
          <h4>The 0-100 scale</h4>
          {/* Bands are percentages of MAX_ATTAINABLE, so this stays accurate as
              factors are added to the catalog. */}
          <div className="bands">
            {GRADE_SCALE.map((b) => (
              <div className={`band ${b.tier}`} key={b.tier}>
                <div className="bandhead">
                  <b><Dot /> {b.label}</b><span>{b.min}-{b.max}</span>
                </div>
                <p>{b.meaning}</p>
                <p className="act"><ArrowRight size={13} /> {b.action}</p>
              </div>
            ))}
          </div>
          <p className="note">
            Graded for <b>{active.label.toLowerCase()}</b>. A high grade means:{" "}
            <b>{active.meaning}</b> Only the factors below count, so nothing you cannot sell against
            is held against a lead.
          </p>
          <p className="note">
            The grade measures <b>opportunity</b>, not business quality: how badly they need work
            (<b>Need</b>) plus how easily you can reach them (<b>Reach</b>). Every factor below is
            worth points, and because the website factors are mutually exclusive the most any real
            lead can add up to is <b>{MAX_ATTAINABLE}</b>. A grade is that total as a percentage of
            {" "}<b>{MAX_ATTAINABLE}</b>, so the bands above keep their meaning even as we add new
            checks. Signals we could not check are left out rather than counted as a pass.
          </p>

          <h4>Need, why they&rsquo;d buy</h4>
          <table className="ftable">
            <tbody>
              {need.map((f) => (
                <tr key={f.key}>
                  <td className="fpts">+{f.points}</td>
                  <td className="flabel">{f.label}</td>
                  <td className="fwhy">{f.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">
            The first two are mutually exclusive with the rest, if there&rsquo;s no site (or it&rsquo;s down),
            we can&rsquo;t audit HTTPS, mobile or copyright age, so only that one factor fires.
          </p>

          <h4>Reach, can you actually close them?</h4>
          <table className="ftable">
            <tbody>
              {reach.map((f) => (
                <tr key={f.key}>
                  <td className="fpts">+{f.points}</td>
                  <td className="flabel">{f.label}</td>
                  <td className="fwhy">{f.why}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4>Lead freshness</h4>
          <p className="note">
            Separate from the grade. Freshness is how recently the underlying business listing was
            confirmed at the source, it tells you whether the phone number is still good.
          </p>
          <div className="bands">
            {FRESHNESS_SCALE.map((b) => (
              <div className={`band fdot ${b.level}`} key={b.level}>
                <div className="bandhead">
                  <b><Dot /> {b.label}</b>
                  <span>{b.maxDays === Infinity ? "2+ yrs" : b.maxDays < 365 ? `≤ ${b.maxDays}d` : `≤ ${Math.round(b.maxDays / 365)}y`}</span>
                </div>
                <p>{b.meaning}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
