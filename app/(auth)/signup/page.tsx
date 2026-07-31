"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { SIGNUP_BONUS_CREDITS } from "@/lib/pricing";
import { FreshLeadsMark } from "../../icons";
import { AuthAside } from "../AuthAside";

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      // Instant signup: server creates a pre-confirmed user, then we sign in.
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, fullName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create your account");

      const supabase = createClient();
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signInErr) throw new Error(signInErr.message);

      // Straight to the dashboard: the free credits mean a new account can search
      // and open leads immediately, with no onboarding or quote step in the way.
      // replace, not push, so Back never returns to signup.
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="authwrap">
      <div className="authmain">
      <div className="card authcard">
        <Link href="/" className="brand">
          <div className="logo">
            <FreshLeadsMark size={22} />
          </div>
          <h1>Fresh Leads</h1>
        </Link>
        <h2>Create your account</h2>
        <p className="sub">
          Get {SIGNUP_BONUS_CREDITS} free credits. No credit card required. Search straight away and open
          your first {SIGNUP_BONUS_CREDITS} leads on us.
        </p>

        <form className="authform" onSubmit={onSubmit}>
          <div>
            <label htmlFor="name">Full name</label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <div className="authmsg err">{error}</div>}
          <button className="go" type="submit" disabled={loading}>
            {loading ? "Creating account…" : `Create account, get ${SIGNUP_BONUS_CREDITS} credits`}
          </button>
        </form>

        <p className="authalt">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </div>
      </div>
      <AuthAside variant="signup" />
    </div>
  );
}
