"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Ticket, TicketMessage } from "@/lib/support";
import { AlertTriangle, Check, Clock } from "../../../icons";

const STATUS_LABEL: Record<string, string> = {
  open: "Waiting on us",
  answered: "Replied",
  closed: "Closed",
};

export function TicketThread({
  ticket,
  initialMessages,
}: {
  ticket: Ticket;
  initialMessages: TicketMessage[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [status, setStatus] = useState(ticket.status);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function reply() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/support/tickets/${ticket.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not send that.");
      setMessages(data.messages);
      setStatus(data.ticket.status);
      setBody("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send that.");
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    setBusy(true);
    await fetch(`/api/support/tickets/${ticket.id}`, { method: "PATCH" });
    setStatus("closed");
    setBusy(false);
    router.refresh();
  }

  return (
    <>
      <div className="card seqbar">
        <div>
          <b>{STATUS_LABEL[status] ?? status}</b>
          <span className="muted sm">
            {status === "open"
              ? "We have this and will reply here. You will not lose it if you close the tab."
              : status === "answered"
                ? "There is a reply below. Write back and it goes straight back to us."
                : "This one is finished. Replying opens it again."}
          </span>
        </div>
        {status !== "closed" && (
          <button className="ghost sm" onClick={close} disabled={busy}>
            Mark as done
          </button>
        )}
      </div>

      <div className="card">
        <ul className="tkthread">
          {messages.map((m) => (
            <li key={m.id} className={m.author}>
              <div className="tkwho">
                <span className="tkav">{m.author === "support" ? "FL" : "You"}</span>
                <b>{m.author === "support" ? "Fresh Leads" : "You"}</b>
                <span className="muted sm">
                  {new Date(m.createdAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              {/* Plain text, rendered with line breaks preserved. Nothing a customer
                  or an operator writes is ever treated as markup. */}
              <p className="tkbody">{m.body}</p>
            </li>
          ))}
        </ul>

        <div className="tkreply">
          <textarea
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={status === "closed" ? "Write here to open this again" : "Write a reply"}
            maxLength={8000}
          />
          {error && (
            <div className="enricherr">
              <AlertTriangle size={15} /> {error}
            </div>
          )}
          <button className="go accent" onClick={reply} disabled={busy || !body.trim()}>
            {busy ? "Sending..." : status === "closed" ? "Reply and reopen" : "Send reply"}
          </button>
        </div>
      </div>

      <p className="muted sm tkfoot">
        {status === "answered" ? <Check size={12} /> : <Clock size={12} />} Opened{" "}
        {new Date(ticket.createdAt).toLocaleDateString()}. Everything said here stays on your
        account.
      </p>
    </>
  );
}
