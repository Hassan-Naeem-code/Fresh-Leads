"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "../icons";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin]", error);
  }, [error]);

  return (
    <div className="wrap">
      <div className="card errcard">
        <span className="erricon"><AlertTriangle size={22} /></span>
        <h1>This page failed to load</h1>
        <p className="muted">
          A query behind this screen threw. Customer data is untouched: nothing here writes
          anything on its own.
        </p>
        <div className="tkactions">
          <button className="go accent" onClick={reset}>Try again</button>
          <Link className="ghost" href="/admin">Back to overview</Link>
        </div>
        {error.digest && <p className="muted sm"><code>{error.digest}</code></p>}
      </div>
    </div>
  );
}
