"use client";
import { useState } from "react";
import { Mail, Check, Building, Clock } from "../../icons";
import { Empty } from "../Empty";

export type ContactMessage = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  message: string;
  handled: boolean;
  created_at: string;
};

function timeAgo(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function MessagesList({ messages: initial }: { messages: ContactMessage[] }) {
  const [messages, setMessages] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, action: "toggle" | "delete") {
    setBusy(id);
    try {
      const res = await fetch("/api/admin/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (!res.ok) throw new Error();
      if (action === "delete") {
        setMessages((m) => m.filter((x) => x.id !== id));
      } else {
        setMessages((m) => m.map((x) => (x.id === id ? { ...x, handled: !x.handled } : x)));
      }
    } catch {
      // leave state as-is on failure; the row simply won't change
    } finally {
      setBusy(null);
    }
  }

  if (messages.length === 0) {
    return (
      <Empty
        icon={<Mail size={22} />}
        title="No messages yet"
        hint="Anyone who writes from the contact page lands here, with their address, so you can reply."
      />
    );
  }

  return (
    <div className="adm-msgs">
      {messages.map((m) => (
        <div key={m.id} className={`adm-msg-card${m.handled ? " handled" : ""}`}>
          <div className="adm-msg-top">
            <div className="adm-msg-who">
              <b>{m.name}</b>
              {m.company && <span className="adm-msg-co"><Building size={12} /> {m.company}</span>}
              <a className="adm-msg-email" href={`mailto:${m.email}`}><Mail size={12} /> {m.email}</a>
            </div>
            <div className="adm-msg-meta">
              {m.handled && <span className="adm-pill on"><Check size={11} /> Handled</span>}
              <span className="adm-msg-time"><Clock size={12} /> {timeAgo(m.created_at)}</span>
            </div>
          </div>

          <p className="adm-msg-body">{m.message}</p>

          <div className="adm-msg-actions">
            <a
              className="ghost sm"
              href={`mailto:${m.email}?subject=${encodeURIComponent("Re: your message to Fresh Leads")}`}
            >
              <Mail size={14} /> Reply
            </a>
            <button className="ghost sm" onClick={() => act(m.id, "toggle")} disabled={busy === m.id}>
              {m.handled ? "Reopen" : "Mark handled"}
            </button>
            <button
              className="linkish adm-msg-del"
              onClick={() => act(m.id, "delete")}
              disabled={busy === m.id}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
