"use client";
import Link from "next/link";
import { useEffect } from "react";
import { ArrowRight, RotateCcw } from "./icons";

// Root error boundary, renders inside the layout, so brand styles apply.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="wrap" style={{ minHeight: "72vh", display: "grid", placeContent: "center", textAlign: "center" }}>
      <div className="pr-eyebrow" style={{ justifyContent: "center" }}><span className="pill">Something broke</span></div>
      <h1 style={{ fontSize: "clamp(30px,5vw,48px)", letterSpacing: "-.03em", lineHeight: 1.1 }}>
        That didn&rsquo;t go as planned.
      </h1>
      <p style={{ color: "var(--muted)", fontSize: 16, lineHeight: 1.6, margin: "14px auto 26px", maxWidth: "46ch" }}>
        An unexpected error occurred on our end. Try again, if it keeps happening, let us know at{" "}
        <a href="mailto:info@fresh-leads.io" style={{ color: "var(--accent)" }}>info@fresh-leads.io</a>.
      </p>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
        <button className="go accent" onClick={reset}><RotateCcw size={16} /> Try again</button>
        <Link href="/" className="pr-btn ghost">Back home <ArrowRight size={15} /></Link>
      </div>
    </div>
  );
}
