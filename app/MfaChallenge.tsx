"use client";

import { useState } from "react";
import { Shield, AlertTriangle, Key, Mail, Phone } from "./icons";

// The screen between a correct password and the product.
//
// It offers every method the account has set up, plus recovery codes, because the one
// time somebody needs this screen to work is the time their usual method is not to
// hand.

type Factor = { id: string; kind: string; label: string | null; phone: string | null };

const KIND_LABEL: Record<string, string> = {
  totp: "Code from your authenticator app",
  email: "Emailed code",
  sms: "Texted code",
};

export function MfaChallenge({
  factors,
  who,
  next,
  admin = false,
}: {
  factors: Factor[];
  who: string;
  next: string;
  admin?: boolean;
}) {
  const [factor, setFactor] = useState<Factor | null>(
    // Default to the app if there is one: it is the method that works with no signal
    // and no waiting.
    factors.find((f) => f.kind === "totp") ?? factors[0] ?? null
  );
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(false);
  const [usingRecovery, setUsingRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function post(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "That did not work.");
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function sendCode(f: Factor) {
    const d = await post({ action: "send_code", factorId: f.id });
    if (!d) return;
    setChallengeId(d.challengeId);
    setSentTo(d.sentTo);
  }

  async function submit() {
    const payload = usingRecovery
      ? { action: "recovery", code }
      : {
          action: "verify",
          factorId: factor!.id,
          code,
          trust,
          ...(challengeId ? { challengeId } : {}),
        };
    const d = await post(payload);
    if (!d) return;
    // Full navigation, not a client route change: the cookie was just set on this
    // response and the next request has to carry it.
    window.location.href = next;
  }

  return (
    <div className="card mfacard">
      <h2><Shield size={18} /> One more step</h2>
      <p className="muted">
        {admin ? "Operator sign in for " : "Signed in as "}
        <b>{who}</b>. Confirm it is you.
      </p>

      {error && <div className="crmnote bad"><AlertTriangle size={15} /> {error}</div>}

      {usingRecovery ? (
        <div className="mfastep">
          <p className="muted">
            Enter one of the recovery codes you saved when you set this up. Each works once.
          </p>
          <input
            className="mfacode wide"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXXX-XXXXX"
            autoFocus
          />
          <div className="tkactions">
            <button className="go accent" onClick={submit} disabled={busy || code.length < 4}>
              {busy ? "Checking..." : "Use this code"}
            </button>
            <button className="ghost" onClick={() => { setUsingRecovery(false); setCode(""); setError(""); }}>
              Back
            </button>
          </div>
        </div>
      ) : !factor ? (
        <p className="muted">
          This account has no second factor set up, which should not be possible. Contact
          support and quote this address.
        </p>
      ) : (
        <div className="mfastep">
          {factors.length > 1 && (
            <div className="mfaswitch">
              {factors.map((f) => (
                <button
                  key={f.id}
                  className={`faqchip ${factor.id === f.id ? "on" : ""}`}
                  onClick={() => { setFactor(f); setChallengeId(null); setCode(""); setError(""); }}
                >
                  {f.kind === "totp" ? <Key size={12} /> : f.kind === "sms" ? <Phone size={12} /> : <Mail size={12} />}
                  {KIND_LABEL[f.kind] ?? f.kind}
                </button>
              ))}
            </div>
          )}

          {factor.kind === "totp" ? (
            <p className="muted">Open your authenticator app and type the six digits it shows.</p>
          ) : challengeId ? (
            <p className="muted">We sent a code to {sentTo}. It expires in ten minutes.</p>
          ) : (
            <>
              <p className="muted">
                We will send a code to {factor.kind === "sms" ? factor.phone : "your email address"}.
              </p>
              <button className="go accent" onClick={() => sendCode(factor)} disabled={busy}>
                {busy ? "Sending..." : "Send the code"}
              </button>
            </>
          )}

          {(factor.kind === "totp" || challengeId) && (
            <>
              <input
                className="mfacode"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                inputMode="numeric"
                maxLength={6}
                autoFocus
              />
              <label className="prefcheck">
                <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
                <span>
                  <b>Trust this device for 30 days</b>
                  <span className="muted sm">Only do this on a machine that is yours alone.</span>
                </span>
              </label>
              <div className="tkactions">
                <button className="go accent" onClick={submit} disabled={busy || code.length < 6}>
                  {busy ? "Checking..." : "Continue"}
                </button>
                {factor.kind !== "totp" && (
                  <button className="ghost" onClick={() => sendCode(factor)} disabled={busy}>
                    Send another
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {!usingRecovery && (
        <p className="muted sm mfafoot">
          Lost your phone?{" "}
          <button className="linkish" onClick={() => { setUsingRecovery(true); setCode(""); setError(""); }}>
            Use a recovery code
          </button>
        </p>
      )}
    </div>
  );
}
