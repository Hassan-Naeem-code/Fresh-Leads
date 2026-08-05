"use client";

import { useState } from "react";
import { Users, AlertTriangle, ArrowRight } from "../icons";

export function JoinPanel({ token, email }: { token: string; email: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState("");

  async function accept() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "That invite could not be used.");
      setJoined(data.name || "the team");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (joined) {
    return (
      <div className="card mfacard">
        <h2><Users size={18} /> You are in</h2>
        <p className="muted">
          You have joined <b>{joined}</b>. You now share their credits and their plan, and
          every lead anyone on the team has already opened is open for you too.
        </p>
        <a className="go accent" href="/dashboard">Go to your dashboard <ArrowRight size={15} /></a>
      </div>
    );
  }

  return (
    <div className="card mfacard">
      <h2><Users size={18} /> Join a team</h2>
      <p className="muted">
        You are signed in as <b>{email}</b>. An invite only works for the address it was
        sent to, so if this is not the right account, sign out and sign in as the one that
        was invited.
      </p>
      <p className="muted sm">
        Joining means you spend the team&rsquo;s credits rather than your own, and anything
        you open is visible to everyone on it. Any credits already on your own account stay
        yours and are not moved.
      </p>
      <button className="go accent" onClick={accept} disabled={busy || token.length < 20}>
        {busy ? "Joining..." : "Accept the invite"}
      </button>
      {token.length < 20 && (
        <p className="muted sm">This link is missing its invite code. Ask for a fresh one.</p>
      )}
      {error && <div className="status error"><AlertTriangle size={15} /> {error}</div>}
    </div>
  );
}
