"use client";
import { useState } from "react";
import { Check, ArrowRight } from "../icons";

export function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, company, message, website }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  if (status === "sent") {
    return (
      <div className="card contact-sent">
        <div className="contact-senticon"><Check size={26} /></div>
        <h3>Message sent</h3>
        <p>Thanks for reaching out, we&rsquo;ll get back to you within one business day.</p>
      </div>
    );
  }

  return (
    <form className="card contact-form" onSubmit={onSubmit}>
      <div className="obrow">
        <div className="obfield">
          <label htmlFor="c-name">Your name</label>
          <input id="c-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="obfield">
          <label htmlFor="c-email">Email</label>
          <input id="c-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
      </div>
      <div className="obfield">
        <label htmlFor="c-company">Company <span style={{ opacity: 0.6 }}>(optional)</span></label>
        <input id="c-company" value={company} onChange={(e) => setCompany(e.target.value)} />
      </div>
      <div className="obfield">
        <label htmlFor="c-message">How can we help?</label>
        <textarea id="c-message" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} required
          placeholder="Tell us about your niche, volume, or anything you'd like to know." />
      </div>
      {/* Honeypot: hidden from humans, catnip for bots. */}
      <input
        type="text" tabIndex={-1} autoComplete="off" value={website}
        onChange={(e) => setWebsite(e.target.value)}
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
        aria-hidden="true"
      />
      {error && <div className="authmsg err">{error}</div>}
      <button className="go accent" type="submit" disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : <>Send message <ArrowRight size={16} /></>}
      </button>
    </form>
  );
}
