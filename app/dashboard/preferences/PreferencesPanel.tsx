"use client";

import { useState } from "react";
import type { Preferences } from "@/lib/preferences";
import { RESULT_COUNT_CHOICES } from "@/lib/preferences";
import type { BuyerProfile, PlaybookId } from "@/lib/playbooks";
import { Check, AlertTriangle } from "../../icons";

// Everything here saves on one button rather than on every keystroke. These are
// settings, not a document: an autosave that fires while somebody is still deciding
// makes it unclear what state they are actually in.

export function PreferencesPanel({
  initialPreferences,
  initialProfile,
  playbooks,
}: {
  initialPreferences: Preferences;
  initialProfile: BuyerProfile;
  playbooks: { id: PlaybookId; label: string; blurb: string }[];
}) {
  const [prefs, setPrefs] = useState(initialPreferences);
  const [profile, setProfile] = useState(initialProfile);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const set = <K extends keyof Preferences>(k: K, v: Preferences[K]) =>
    setPrefs((p) => ({ ...p, [k]: v }));

  async function save() {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const [a, b] = await Promise.all([
        fetch("/api/preferences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(prefs),
        }),
        fetch("/api/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playbook: profile.playbook,
            sells: profile.sells,
            location: profile.location,
          }),
        }),
      ]);
      if (!a.ok || !b.ok) throw new Error("Some of that did not save. Try again.");
      setNote("Saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {note && <div className="crmnote good"><Check size={15} /> {note}</div>}
      {error && <div className="crmnote bad"><AlertTriangle size={15} /> {error}</div>}

      <div className="card">
        <h3 className="cardtitle">You</h3>
        <div className="acctform">
          <label>
            What should we call you
            <input
              value={prefs.displayName}
              onChange={(e) => set("displayName", e.target.value)}
              placeholder="Your name"
              maxLength={80}
            />
            <span className="muted sm">Used in the product, never shown to a lead.</span>
          </label>
        </div>
      </div>

      <div className="card">
        <h3 className="cardtitle">What you sell</h3>
        <p className="muted sm">
          This is what the grade is calculated against. Get it right and a high grade means
          something; get it wrong and every business looks the same.
        </p>
        <div className="prefplaybooks">
          {playbooks.map((p) => (
            <button
              key={p.id}
              className={`prefpb ${profile.playbook === p.id ? "on" : ""}`}
              onClick={() => setProfile((s) => ({ ...s, playbook: p.id }))}
              aria-pressed={profile.playbook === p.id}
            >
              <b>{p.label}</b>
              <span>{p.blurb}</span>
            </button>
          ))}
        </div>
        <div className="acctform">
          <label className="wide">
            In your own words
            <input
              value={profile.sells}
              onChange={(e) => setProfile((s) => ({ ...s, sells: e.target.value }))}
              placeholder="e.g. Card terminals and same day setup for independent restaurants"
              maxLength={500}
            />
          </label>
        </div>
      </div>

      <div className="card">
        <h3 className="cardtitle">Search defaults</h3>
        <div className="acctform">
          <label>
            Where you usually look
            <input
              value={profile.location}
              onChange={(e) => setProfile((s) => ({ ...s, location: e.target.value }))}
              placeholder="e.g. Austin, TX"
              maxLength={160}
            />
            <span className="muted sm">Prefilled on the search screen. You can always change it there.</span>
          </label>
          <label>
            How many results to ask for
            <select
              value={prefs.defaultResultCount ?? ""}
              onChange={(e) =>
                set("defaultResultCount", e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">No preference</option>
              {RESULT_COUNT_CHOICES.map((n) => (
                <option key={n} value={n}>{n} leads</option>
              ))}
            </select>
            <span className="muted sm">
              Asking for more costs nothing. A credit is only spent when you open one.
            </span>
          </label>
        </div>
      </div>

      <div className="card">
        <h3 className="cardtitle">Email from us</h3>
        <label className="prefcheck">
          <input
            type="checkbox"
            checked={prefs.notifyProductNews}
            onChange={(e) => set("notifyProductNews", e.target.checked)}
          />
          <span>
            <b>Product news</b>
            <span className="muted sm">When something is added or changed. Rare.</span>
          </span>
        </label>
        <label className="prefcheck">
          <input
            type="checkbox"
            checked={prefs.notifyWeeklyDigest}
            onChange={(e) => set("notifyWeeklyDigest", e.target.checked)}
          />
          <span>
            <b>Weekly summary</b>
            <span className="muted sm">
              What changed at the businesses you are watching: a site that went down, a booking
              system that appeared.
            </span>
          </span>
        </label>
        <p className="muted sm prefnote">
          Receipts, password resets and anything about your account are always sent. They are
          not marketing and switching them off would hide things you need to see.
        </p>
      </div>

      <div className="tkactions">
        <button className="go accent" onClick={save} disabled={busy}>
          {busy ? "Saving..." : "Save changes"}
        </button>
      </div>
    </>
  );
}
