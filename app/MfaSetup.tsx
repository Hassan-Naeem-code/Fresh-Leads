"use client";

import { useEffect, useState } from "react";
import { Shield, Check, AlertTriangle, Key, Mail, Phone, Copy } from "./icons";

// Setting up a second factor, and the screen people see once and never again.
//
// The recovery codes are the part that matters most and are the easiest to skip past,
// so they are shown on their own step with a confirmation, not as a footnote under a
// success message.

type Factor = {
  id: string; kind: string; label: string | null; phone: string | null;
  confirmedAt: string | null; lastUsedAt: string | null;
};

type Info = {
  who: string;
  factors: Factor[];
  recoveryCodesLeft: number;
  available: { totp: boolean; email: boolean; sms: boolean; passkey: boolean };
};

const KIND_LABEL: Record<string, string> = {
  totp: "Authenticator app",
  email: "Email code",
  sms: "Text message",
  passkey: "Passkey",
};

export function MfaSetup({ mandatory, onDone }: { mandatory: boolean; onDone?: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Enrolment in progress.
  const [factorId, setFactorId] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [qr, setQr] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [savedCodes, setSavedCodes] = useState(false);

  async function load() {
    const res = await fetch("/api/mfa");
    if (res.ok) setInfo(await res.json());
  }
  useEffect(() => { load(); }, []);

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

  function reset() {
    setChoosing(null); setFactorId(""); setChallengeId(null);
    setSecret(""); setQr(""); setSentTo(""); setCode(""); setPhone("");
  }

  async function startTotp() {
    const d = await post({ action: "start_totp" });
    if (!d) return;
    setFactorId(d.factorId); setSecret(d.secret); setQr(d.qr); setChoosing("totp");
  }

  async function startEmail() {
    const d = await post({ action: "start_email" });
    if (!d) return;
    setFactorId(d.factorId); setChallengeId(d.challengeId); setSentTo(d.sentTo); setChoosing("email");
  }

  async function startSms() {
    const d = await post({ action: "start_sms", phone });
    if (!d) return;
    setFactorId(d.factorId); setChallengeId(d.challengeId); setSentTo(d.sentTo); setChoosing("sms-code");
  }

  async function confirm() {
    const d = await post({
      action: "confirm",
      factorId,
      code,
      ...(challengeId ? { challengeId } : {}),
    });
    if (!d) return;
    if (d.recoveryCodes) setRecoveryCodes(d.recoveryCodes);
    reset();
    await load();
    if (!d.recoveryCodes) onDone?.();
  }

  if (recoveryCodes) {
    return (
      <div className="card mfacard">
        <h2><Key size={18} /> Save these somewhere safe</h2>
        <p className="muted">
          Ten codes, each usable once. They are the way back in if you lose your phone, and
          this is the only time they are shown. Nobody, including us, can read them again.
        </p>
        <ul className="mfacodes">
          {recoveryCodes.map((c) => <li key={c}>{c}</li>)}
        </ul>
        <div className="tkactions">
          <button
            className="ghost"
            onClick={() => navigator.clipboard?.writeText(recoveryCodes.join("\n"))}
          >
            <Copy size={14} /> Copy them
          </button>
          <button
            className="ghost"
            onClick={() => {
              const blob = new Blob([recoveryCodes.join("\n")], { type: "text/plain" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "fresh-leads-recovery-codes.txt";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download
          </button>
        </div>
        <label className="prefcheck">
          <input type="checkbox" checked={savedCodes} onChange={(e) => setSavedCodes(e.target.checked)} />
          <span><b>I have saved them somewhere I can get to without this account.</b></span>
        </label>
        <button
          className="go accent"
          disabled={!savedCodes}
          onClick={() => { setRecoveryCodes(null); onDone?.(); }}
        >
          Done
        </button>
      </div>
    );
  }

  const confirmed = (info?.factors ?? []).filter((f) => f.confirmedAt);

  return (
    <div className="card mfacard">
      <h2><Shield size={18} /> {mandatory && confirmed.length === 0 ? "Protect your account" : "Two factor methods"}</h2>

      {mandatory && confirmed.length === 0 && (
        <p className="muted">
          Every account needs a second step at sign in, so a stolen password on its own is
          not enough. Pick one now; you can add more afterwards.
        </p>
      )}

      {error && <div className="crmnote bad"><AlertTriangle size={15} /> {error}</div>}

      {confirmed.length > 0 && (
        <ul className="mfalist">
          {confirmed.map((f) => (
            <li key={f.id}>
              <span className="mfaicon">
                {f.kind === "totp" ? <Key size={15} /> : f.kind === "sms" ? <Phone size={15} /> : <Mail size={15} />}
              </span>
              <div>
                <b>{KIND_LABEL[f.kind] ?? f.kind}</b>
                <span className="muted sm">
                  {f.label ?? f.phone ?? ""}
                  {f.lastUsedAt ? `, last used ${new Date(f.lastUsedAt).toLocaleDateString()}` : ""}
                </span>
              </div>
              <button
                className="linkish"
                disabled={busy}
                onClick={async () => { if (await post({ action: "remove", factorId: f.id })) load(); }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {choosing === null && (
        <>
          <div className="mfachoices">
            <button className="prefpb" onClick={startTotp} disabled={busy}>
              <b>Authenticator app</b>
              <span>A code from Google Authenticator, 1Password, Authy or similar. Works with no signal.</span>
            </button>
            {info?.available.email && (
              <button className="prefpb" onClick={startEmail} disabled={busy}>
                <b>Email code</b>
                <span>We send a six digit code to {info.who} each time you sign in.</span>
              </button>
            )}
            {info?.available.sms && (
              <button className="prefpb" onClick={() => setChoosing("sms")} disabled={busy}>
                <b>Text message</b>
                <span>A code to your phone. Less secure than an app, and better than nothing.</span>
              </button>
            )}
          </div>
          {info && !info.available.sms && (
            <p className="muted sm">Text message codes are not switched on for this deployment.</p>
          )}
          {confirmed.length > 0 && info && (
            <p className="muted sm mfafoot">
              {info.recoveryCodesLeft} recovery {info.recoveryCodesLeft === 1 ? "code" : "codes"} left.{" "}
              <button
                className="linkish"
                onClick={async () => {
                  const d = await post({ action: "new_recovery_codes" });
                  if (d) setRecoveryCodes(d.codes);
                }}
              >
                Generate a new set
              </button>
              , which cancels the old ones.
            </p>
          )}
        </>
      )}

      {choosing === "totp" && (
        <div className="mfastep">
          <p className="muted">Scan this with your authenticator app, then type the code it shows.</p>
          {qr && <img src={qr} alt="" className="mfaqr" width={220} height={220} />}
          <p className="muted sm">
            Cannot scan? Enter this key by hand: <code className="mfasecret">{secret}</code>
          </p>
          <input
            className="mfacode"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="000000"
            inputMode="numeric"
            maxLength={6}
            autoFocus
          />
          <div className="tkactions">
            <button className="go accent" onClick={confirm} disabled={busy || code.length < 6}>
              {busy ? "Checking..." : "Turn it on"}
            </button>
            <button className="ghost" onClick={reset} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

      {choosing === "sms" && (
        <div className="mfastep">
          <p className="muted">Your mobile number, with the country code.</p>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 512 555 0142"
            autoFocus
          />
          <div className="tkactions">
            <button className="go accent" onClick={startSms} disabled={busy || phone.length < 6}>
              {busy ? "Sending..." : "Send me a code"}
            </button>
            <button className="ghost" onClick={reset} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

      {(choosing === "email" || choosing === "sms-code") && (
        <div className="mfastep">
          <p className="muted">We sent a code to {sentTo}. It expires in ten minutes.</p>
          <input
            className="mfacode"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="000000"
            inputMode="numeric"
            maxLength={6}
            autoFocus
          />
          <div className="tkactions">
            <button className="go accent" onClick={confirm} disabled={busy || code.length < 6}>
              {busy ? "Checking..." : "Turn it on"}
            </button>
            <button className="ghost" onClick={reset} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

      {confirmed.length > 0 && choosing === null && !mandatory && (
        <p className="muted sm mfafoot"><Check size={13} /> Your account is protected.</p>
      )}
    </div>
  );
}
