"use client";

import { useRef, useState } from "react";
import { Upload, Download, Check, AlertTriangle, Coin } from "../../icons";
import { setCredits } from "../credit-store";

// Upload a list, get it back filled in.
//
// The engine already existed behind /api/enrich. Without this screen it was reachable
// only with curl, which for most customers means it did not exist.

type Result = { rows: number; enriched: number; filename: string; blobUrl: string };

const MAX_MB = 5;

export function EnrichForm({ credits }: { credits: number }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rowGuess, setRowGuess] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  /** Count the lines locally so the cost can be shown before anything is spent. */
  async function onPick(f: File | null) {
    setError("");
    setResult(null);
    setFile(f);
    setRowGuess(0);
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) {
      setError(`That file is over ${MAX_MB}MB. Split it and upload in parts.`);
      setFile(null);
      return;
    }
    const text = await f.text();
    // Minus the header. Good enough for an estimate; the server is the authority.
    const lines = text.split(/\r?\n/).filter((l) => l.trim()).length;
    setRowGuess(Math.max(0, lines - 1));
  }

  async function run() {
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const csv = await file.text();
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: csv,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (typeof data.credits === "number") setCredits(data.credits);
        throw new Error(data.error || "Could not enrich that list.");
      }

      const remaining = res.headers.get("X-Credits-Remaining");
      if (remaining) setCredits(Number(remaining));

      const blob = await res.blob();
      setResult({
        rows: Number(res.headers.get("X-Rows-Total") ?? 0),
        enriched: Number(res.headers.get("X-Rows-Enriched") ?? 0),
        filename: file.name.replace(/\.csv$/i, "") + "-enriched.csv",
        blobUrl: URL.createObjectURL(blob),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enrich that list.");
    } finally {
      setBusy(false);
    }
  }

  const tooMany = rowGuess > credits;

  return (
    <div className="card enrichcard">
      <label className="enrichdrop">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        />
        <Upload size={22} />
        <b>{file ? file.name : "Choose a CSV file"}</b>
        <span>
          {file
            ? `${rowGuess} row${rowGuess === 1 ? "" : "s"} to enrich`
            : "A header row, then one business per line"}
        </span>
      </label>

      <div className="enrichcols">
        <div>
          <h3>What your file needs</h3>
          <p>
            One column naming the business, or a column with its website. Anything else you
            include comes back untouched alongside the new columns.
          </p>
          <p className="muted sm">
            We recognise the usual headings: name, company, business, account name, website,
            url, domain, city, town, phone, email.
          </p>
        </div>
        <div>
          <h3>What you get back</h3>
          <p>
            Verified phone and email, the owner where we can find one, social profiles, whether
            they are hiring, estimated size, the POS or booking system they use, and whether
            their website is live.
          </p>
        </div>
      </div>

      {file && (
        <div className={`enrichcost ${tooMany ? "short" : ""}`}>
          <Coin size={15} />
          <span>
            {tooMany ? (
              <>
                This list is <b>{rowGuess} rows</b> and you have <b>{credits} credits</b>. Top up,
                or upload a smaller file.
              </>
            ) : (
              <>
                Up to <b>{rowGuess} credits</b>, one per row we manage to enrich. Rows we cannot
                identify are returned untouched and cost nothing.
              </>
            )}
          </span>
        </div>
      )}

      {error && (
        <div className="enricherr">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {result && (
        <div className="enrichdone">
          <Check size={16} />
          <div>
            <b>
              {result.enriched} of {result.rows} rows enriched
            </b>
            <span>
              {result.rows - result.enriched > 0
                ? `${result.rows - result.enriched} could not be identified and were not charged for.`
                : "Every row was matched."}
            </span>
          </div>
          <a className="go accent sm" href={result.blobUrl} download={result.filename}>
            <Download size={15} /> Download
          </a>
        </div>
      )}

      <div className="enrichactions">
        <button className="go" onClick={run} disabled={!file || busy || tooMany}>
          {busy ? "Enriching, this can take a minute..." : "Enrich this list"}
        </button>
        {file && !busy && (
          <button
            className="ghost sm"
            onClick={() => {
              setFile(null);
              setResult(null);
              setError("");
              if (fileRef.current) fileRef.current.value = "";
            }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
