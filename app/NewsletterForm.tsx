"use client";

import { useState } from "react";
import { Check, ArrowRight, AlertTriangle } from "./icons";

// Joining the mailing list.
//
// The reply is deliberately identical whether the address is new, already on the list,
// or previously unsubscribed. A form that says "you are already subscribed" is a way to
// ask us whether a given person is a customer, one address at a time.
export function NewsletterForm({ source = "footer" }: { source?: string }) {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source, website }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not sign you up");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="nlform">
        <span className="nlhead">Newsletter</span>
        <p className="nlsent">
          <Check size={14} /> Check your inbox and click the link to confirm. Nothing is sent
          until you do.
        </p>
      </div>
    );
  }

  return (
    <form className="nlform" onSubmit={submit}>
      {/* An eyebrow, matching the other footer columns, so this reads as a section of the
          footer rather than a stray form dropped into it. */}
      <span className="nlhead">Newsletter</span>
      <label className="nllabel" htmlFor="nl-email">
        What we find in local business data. Monthly at most.
      </label>
      {/* Input and button are ONE control rather than two of different shapes. The
          button used to be a dashboard style button in a marketing footer, which is
          where the mismatched height and the muddy colour came from. */}
      <div className="nlrow">
        <input
          id="nl-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
        />
        <button className="pr-btn accent sm" type="submit" disabled={busy || !email.includes("@")}>
          {busy ? "Sending..." : "Subscribe"} <ArrowRight size={14} />
        </button>
      </div>
      {/* Hidden from people, irresistible to bots. Kept out of the tab order and out of
          the accessibility tree rather than merely off screen. */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="nlhp"
      />
      {error && (
        <span className="nlerr">
          <AlertTriangle size={13} /> {error}
        </span>
      )}
    </form>
  );
}
