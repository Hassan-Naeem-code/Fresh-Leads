"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "../icons";

// A failure inside the app, caught before it takes the whole page down.
//
// Two things it deliberately does not do: blame the user, and pretend to know what
// went wrong. It offers the one action that fixes most transient failures, and a way
// out of the corner if it does not.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server side we have logs; this is the client half, which otherwise vanishes.
    console.error("[dashboard]", error);
  }, [error]);

  return (
    <div className="wrap">
      <div className="card errcard">
        <span className="erricon"><AlertTriangle size={22} /></span>
        <h1>That did not load</h1>
        <p className="muted">
          Something on our side failed while building this page. Nothing you were working on
          has been lost, and no credits were spent.
        </p>
        <div className="tkactions">
          <button className="go accent" onClick={reset}>Try again</button>
          <Link className="ghost" href="/dashboard">Back to search</Link>
        </div>
        {error.digest && (
          <p className="muted sm">
            If it keeps happening, quote this when you open a ticket: <code>{error.digest}</code>
          </p>
        )}
      </div>
    </div>
  );
}
