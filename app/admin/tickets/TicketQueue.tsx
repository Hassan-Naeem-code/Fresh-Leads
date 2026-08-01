"use client";

import { useState } from "react";
import Link from "next/link";
import type { AdminTicket, TicketMessage } from "@/lib/support";
import { Mail, Clock, Check, MessageSquare } from "../../icons";

// One screen: the queue on the left, the open thread underneath. Replying is the whole
// point of this page, so it is never more than one click away from the list.

const STATUS_LABEL: Record<string, string> = {
  open: "Waiting on us",
  answered: "Replied",
  closed: "Closed",
};

const TOPIC_LABEL: Record<string, string> = {
  leads: "Leads",
  billing: "Billing",
  technical: "Technical",
  account: "Account",
  other: "Other",
};

export function TicketQueue({
  tickets: initial,
  includeClosed,
}: {
  tickets: AdminTicket[];
  includeClosed: boolean;
}) {
  const [tickets, setTickets] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  async function open(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setMessages([]);
    setReply("");
    const res = await fetch(`/api/admin/tickets?id=${id}`);
    if (res.ok) setMessages((await res.json()).messages);
  }

  async function send(id: string) {
    setBusy(true);
    const res = await fetch("/api/admin/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "reply", body: reply }),
    });
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages);
      setReply("");
      setTickets((ts) => ts.map((t) => (t.id === id ? { ...t, status: "answered" } : t)));
    }
    setBusy(false);
  }

  async function close(id: string) {
    setBusy(true);
    await fetch("/api/admin/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "close" }),
    });
    setTickets((ts) =>
      includeClosed
        ? ts.map((t) => (t.id === id ? { ...t, status: "closed" } : t))
        : ts.filter((t) => t.id !== id)
    );
    if (openId === id) setOpenId(null);
    setBusy(false);
  }

  return (
    <>
      <div className="adm-tkfilter">
        <Link className={includeClosed ? "" : "on"} href="/admin/tickets">
          Open
        </Link>
        <Link className={includeClosed ? "on" : ""} href="/admin/tickets?closed=1">
          Everything
        </Link>
      </div>

      {tickets.length === 0 ? (
        <div className="adm-empty">Nothing here.</div>
      ) : (
        <div className="adm-msgs">
          {tickets.map((t) => (
            <div key={t.id} className={`adm-msg-card${t.status === "closed" ? " handled" : ""}`}>
              <div className="adm-msg-top">
                <div className="adm-msg-who">
                  <b>{t.subject}</b>
                  <span className="adm-msg-co">
                    <MessageSquare size={12} /> {TOPIC_LABEL[t.topic] ?? t.topic}
                  </span>
                  {t.email && (
                    <a className="adm-msg-email" href={`mailto:${t.email}`}>
                      <Mail size={12} /> {t.email}
                    </a>
                  )}
                </div>
                <span className={`tkstatus ${t.status}`}>
                  {t.status === "answered" ? <Check size={11} /> : <Clock size={11} />}
                  {STATUS_LABEL[t.status] ?? t.status}
                </span>
              </div>

              <p className="adm-msg-meta">
                Opened {new Date(t.createdAt).toLocaleString()}, last activity{" "}
                {new Date(t.lastMessageAt).toLocaleString()}
              </p>

              <div className="adm-msg-actions">
                <button className="linkish" onClick={() => open(t.id)}>
                  {openId === t.id ? "Hide" : "Open and reply"}
                </button>
                {t.status !== "closed" && (
                  <button className="linkish" onClick={() => close(t.id)} disabled={busy}>
                    Close
                  </button>
                )}
              </div>

              {openId === t.id && (
                <div className="adm-tkthread">
                  <ul className="tkthread">
                    {messages.map((m) => (
                      <li key={m.id} className={m.author}>
                        <div className="tkwho">
                          <span className="tkav">{m.author === "support" ? "FL" : "C"}</span>
                          <b>{m.author === "support" ? "You" : "Customer"}</b>
                          <span className="muted sm">{new Date(m.createdAt).toLocaleString()}</span>
                        </div>
                        <p className="tkbody">{m.body}</p>
                      </li>
                    ))}
                  </ul>
                  <textarea
                    rows={5}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Your reply. The customer sees this in their account."
                    maxLength={8000}
                  />
                  <button
                    className="go accent sm"
                    onClick={() => send(t.id)}
                    disabled={busy || !reply.trim()}
                  >
                    {busy ? "Sending..." : "Send reply"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
