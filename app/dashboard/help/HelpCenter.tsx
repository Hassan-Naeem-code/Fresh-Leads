"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { searchFaq, type FaqEntry, type FaqTopic } from "@/lib/faq";
import { TICKET_TOPICS, type Ticket, type TicketTopic } from "@/lib/support";
import {
  Search, ChevronDown, MessageSquare, Plus, AlertTriangle, Check, Clock, ArrowRight,
} from "../../icons";

// Help, in the order a person actually needs it: search first, browse second, ask
// last. The ticket form sits at the bottom rather than the top on purpose, because
// most questions are already answered above it and a form at the top invites a
// ticket before anyone has looked.

const STATUS_LABEL: Record<string, string> = {
  open: "Waiting on us",
  answered: "Replied",
  closed: "Closed",
};

export function HelpCenter({
  faq,
  topics,
  initialTickets,
}: {
  faq: FaqEntry[];
  topics: { id: FaqTopic; label: string }[];
  initialTickets: Ticket[];
}) {
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<FaqTopic | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets);

  const [asking, setAsking] = useState(false);
  const [subject, setSubject] = useState("");
  const [ticketTopic, setTicketTopic] = useState<TicketTopic>("leads");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const results = useMemo(() => {
    const byTopic = topic === "all" ? faq : faq.filter((e) => e.topic === topic);
    return searchFaq(query, byTopic);
  }, [faq, query, topic]);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, topic: ticketTopic, body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not open that ticket.");
      setTickets((prev) => [data.ticket, ...prev]);
      setSubject("");
      setBody("");
      setAsking(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open that ticket.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {tickets.length > 0 && (
        <div className="card">
          <h3 className="cardtitle">Your tickets</h3>
          <ul className="tklist">
            {tickets.map((t) => (
              <li key={t.id}>
                <MessageSquare size={15} />
                <div>
                  <b>{t.subject}</b>
                  <span className="muted sm">
                    Opened {new Date(t.createdAt).toLocaleDateString()}
                    {t.lastMessageAt !== t.createdAt
                      ? `, last activity ${new Date(t.lastMessageAt).toLocaleDateString()}`
                      : ""}
                  </span>
                </div>
                <span className={`tkstatus ${t.status}`}>
                  {t.status === "answered" && <Check size={11} />}
                  {t.status === "open" && <Clock size={11} />}
                  {STATUS_LABEL[t.status] ?? t.status}
                </span>
                <Link className="ghost sm" href={`/dashboard/help/${t.id}`}>
                  Open <ArrowRight size={13} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h3 className="cardtitle">Common questions</h3>

        <div className="faqsearch">
          <Search size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for anything, e.g. refund, bounce, cancel"
            aria-label="Search the help articles"
          />
        </div>

        <div className="faqtopics">
          <button
            className={`faqchip ${topic === "all" ? "on" : ""}`}
            onClick={() => setTopic("all")}
          >
            Everything
          </button>
          {topics.map((t) => (
            <button
              key={t.id}
              className={`faqchip ${topic === t.id ? "on" : ""}`}
              onClick={() => setTopic(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {results.length === 0 ? (
          <p className="muted sm faqnone">
            Nothing here matches that. That is a good reason to open a ticket, and it also tells
            us this page is missing something.
          </p>
        ) : (
          <ul className="faqlist">
            {results.map((e) => {
              const isOpen = open === e.id;
              return (
                <li key={e.id} className={isOpen ? "on" : ""}>
                  <button
                    className="faqq"
                    onClick={() => setOpen(isOpen ? null : e.id)}
                    aria-expanded={isOpen}
                  >
                    <span>{e.q}</span>
                    <ChevronDown size={16} className={isOpen ? "faqchev on" : "faqchev"} />
                  </button>
                  {isOpen && (
                    <div className="faqa">
                      {e.a.map((p, i) => (
                        <p key={i}>{p}</p>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="card">
        <h3 className="cardtitle">Still stuck?</h3>
        {!asking ? (
          <>
            <p className="muted sm">
              Tell us what happened and we will answer here, usually within a working day. If it
              is about a specific lead or a search, include the business name or the words you
              searched for: it is the difference between one reply and four.
            </p>
            <button className="go accent" onClick={() => setAsking(true)}>
              <Plus size={15} /> Open a ticket
            </button>
          </>
        ) : (
          <div className="tkform">
            <label>
              What is it about
              <select
                value={ticketTopic}
                onChange={(e) => setTicketTopic(e.target.value as TicketTopic)}
              >
                {TICKET_TOPICS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Subject
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="One line, e.g. Credit taken for a business that has closed"
                maxLength={140}
              />
            </label>
            <label className="wide">
              What happened
              <textarea
                rows={7}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="What you did, what you expected, and what happened instead."
                maxLength={8000}
              />
            </label>
            {error && (
              <div className="enricherr">
                <AlertTriangle size={15} /> {error}
              </div>
            )}
            <div className="tkactions">
              <button
                className="go accent"
                onClick={submit}
                disabled={busy || subject.trim().length < 3 || body.trim().length < 1}
              >
                {busy ? "Sending..." : "Send it"}
              </button>
              <button className="ghost" onClick={() => setAsking(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
