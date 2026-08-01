"use client";

import { useState } from "react";
import { Plus, X, AlertTriangle, Check, Clock } from "../../../icons";

type Step = { id: string; position: number; delay_days: number; subject: string; body: string };
type Enrollment = {
  id: string; to_email: string; to_name: string | null;
  status: string; last_step: number; next_run_at: string | null;
};

const TAGS = ["business", "city", "first_name"];

// Writing the sequence, and watching it run.
//
// The two are on one screen on purpose: the question a customer actually has is "is
// this thing sending, and to whom", and splitting that across two pages hides it.
export function SequenceEditor({
  sequence, initialSteps, initialEnrollments,
}: {
  sequence: { id: string; name: string; status: string };
  initialSteps: Step[];
  initialEnrollments: Enrollment[];
}) {
  const [steps, setSteps] = useState<Step[]>(initialSteps);
  const [status, setStatus] = useState(sequence.status);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const enrollments = initialEnrollments;

  async function saveStep(step: Step, patch: Partial<Step>) {
    setSteps((prev) => prev.map((s) => (s.id === step.id ? { ...s, ...patch } : s)));
    setSaving(step.id);
    await fetch("/api/email/steps", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: step.id, sequenceId: sequence.id,
        subject: patch.subject, body: patch.body, delayDays: patch.delay_days,
      }),
    });
    setSaving(null);
  }

  async function addStep() {
    const res = await fetch("/api/email/steps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sequenceId: sequence.id }),
    });
    if (!res.ok) return;
    const { step } = await res.json();
    setSteps((prev) => [...prev, step]);
  }

  async function removeStep(id: string) {
    await fetch(`/api/email/steps?id=${id}&sequenceId=${sequence.id}`, { method: "DELETE" });
    setSteps((prev) =>
      prev.filter((s) => s.id !== id).map((s, i) => ({ ...s, position: i + 1 }))
    );
  }

  async function setSequenceStatus(next: "active" | "paused" | "draft") {
    setError("");
    const res = await fetch(`/api/email/sequences/${sequence.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) {
      setError((await res.json()).error || "Could not change that.");
      return;
    }
    setStatus(next);
  }

  const active = enrollments.filter((e) => e.status === "active").length;
  const stopped = enrollments.filter((e) => ["unsubscribed", "bounced", "stopped"].includes(e.status)).length;

  return (
    <>
      <div className="card seqbar">
        <div>
          <b>{status === "active" ? "Sending" : status === "paused" ? "Paused" : "Not started"}</b>
          <span className="muted sm">
            {status === "active"
              ? `${active} leads still moving through this. The next batch goes out on the daily run.`
              : status === "paused"
                ? "Nothing will send until you start it again. Nobody loses their place."
                : "Write your steps, add some leads, then start it."}
          </span>
        </div>
        {status === "active" ? (
          <button className="ghost sm" onClick={() => setSequenceStatus("paused")}>Pause</button>
        ) : (
          <button className="go accent sm" onClick={() => setSequenceStatus("active")}>
            Start sending
          </button>
        )}
      </div>
      {error && <div className="enricherr"><AlertTriangle size={15} /> {error}</div>}

      <div className="card">
        <h3 className="emailh">The emails</h3>
        <p className="muted sm" style={{ marginBottom: 14 }}>
          Use {TAGS.map((t) => <code key={t}>{`{{${t}}}`}</code>).reduce((a, b) => <>{a} {b}</>)} to
          drop in the lead's details. A message with a tag we cannot fill is held back rather
          than sent looking broken.
        </p>

        {steps.map((step) => (
          <div className="seqstep" key={step.id}>
            <div className="seqstephead">
              <span className="seqnum">{step.position}</span>
              {step.position === 1 ? (
                <span className="muted sm">Sent when a lead is added</span>
              ) : (
                <span className="muted sm">
                  <Clock size={12} /> Sent{" "}
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={step.delay_days}
                    onChange={(e) => saveStep(step, { delay_days: Number(e.target.value) })}
                    className="seqdelay"
                  />{" "}
                  days after the one above
                </span>
              )}
              {steps.length > 1 && (
                <button className="seqdel" onClick={() => removeStep(step.id)} aria-label="Remove step">
                  <X size={13} />
                </button>
              )}
            </div>
            <input
              className="seqsubject"
              value={step.subject}
              onChange={(e) => saveStep(step, { subject: e.target.value })}
              placeholder="Subject line"
            />
            <textarea
              className="seqbody"
              rows={7}
              value={step.body}
              onChange={(e) => saveStep(step, { body: e.target.value })}
              placeholder="Write the email. Keep it short, it reads better."
            />
            {saving === step.id && <span className="muted sm">Saving...</span>}
          </div>
        ))}

        <button className="ghost sm" onClick={addStep}>
          <Plus size={14} /> Add a follow up
        </button>

        <p className="muted sm seqfoot">
          Your name, postal address and an unsubscribe link are added to every message
          automatically. There is no way to send without them.
        </p>
      </div>

      <div className="card">
        <h3 className="emailh">Who is in it</h3>
        {enrollments.length === 0 ? (
          <p className="muted sm">
            Nobody yet. Open some leads on the Search page, then use Add to sequence.
          </p>
        ) : (
          <>
            <p className="muted sm" style={{ marginBottom: 12 }}>
              {enrollments.length} total, {active} still going
              {stopped > 0 ? `, ${stopped} stopped or opted out` : ""}.
            </p>
            <ul className="enrlist">
              {enrollments.slice(0, 50).map((e) => (
                <li key={e.id}>
                  <div>
                    <b>{e.to_name || e.to_email}</b>
                    <span className="muted sm">{e.to_email}</span>
                  </div>
                  <span className="muted sm">
                    {e.last_step > 0 ? `${e.last_step} sent` : "not started"}
                  </span>
                  <span className={`enrstatus ${e.status}`}>
                    {e.status === "active" && <Clock size={11} />}
                    {e.status === "finished" && <Check size={11} />}
                    {e.status}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
