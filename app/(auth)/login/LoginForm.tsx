"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { SiteSettings } from "@/lib/site-settings";
import { BrandMark, BrandName } from "../../brand";
import { AuthAside } from "../AuthAside";

function Form({ settings }: { settings: SiteSettings }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <div className="authwrap">
      <div className="authmain">
      <div className="card authcard">
        <Link href="/" className="brand">
          <div className="logo">
            <BrandMark settings={settings} size={22} />
          </div>
          <h1><BrandName settings={settings} /></h1>
        </Link>
        <h2>Welcome back</h2>
        <p className="sub">Sign in to run verified lead searches.</p>

        <form className="authform" onSubmit={onSubmit}>
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <div className="authmsg err">{error}</div>}
          <button className="go" type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="authalt">
          New here? <Link href="/signup">Create an account</Link>
        </p>
      </div>
      </div>
      <AuthAside />
    </div>
  );
}

export function LoginForm({ settings }: { settings: SiteSettings }) {
  return (
    <Suspense>
      <Form settings={settings} />
    </Suspense>
  );
}
