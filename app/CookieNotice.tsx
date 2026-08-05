"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, X } from "./icons";

// THE COOKIE BANNER, AND WHAT IT HONESTLY SAYS.
//
// This site sets five cookies and every one is strictly necessary: the Supabase session,
// the two second-factor passes, the operator session, and the short-lived CSRF state for
// connecting a CRM. There is no analytics, no advertising pixel, and no third party
// watching anybody.
//
// That matters for what this component is allowed to claim. Under the ePrivacy rules,
// consent is required for cookies that are NOT strictly necessary, and asking permission
// for cookies you will set regardless is worse than not asking: it trains people that
// the button is meaningless, and a banner that says "we only set these if you agree"
// while setting them anyway is itself the violation.
//
// So this is a NOTICE for what is essential, and a real CHOICE for the analytics we do
// not yet have. The preference is stored now so that on the day something optional is
// added, the answer is already recorded and honoured rather than retro-fitted.

const KEY = "fl_cookie_choice";

export type CookieChoice = "essential" | "all";

/** What this visitor has agreed to. Read this before loading anything non-essential. */
export function cookieChoice(): CookieChoice | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(KEY);
  return raw === "all" || raw === "essential" ? raw : null;
}

/** May we load analytics for this visitor? Nothing calls this yet, and that is the point. */
export const analyticsAllowed = (): boolean => cookieChoice() === "all";

export function CookieNotice() {
  // Starts hidden and appears only after mount. Rendering it on the server would put a
  // banner into the HTML for people who dismissed it months ago.
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!cookieChoice()) setShow(true);
  }, []);

  function choose(choice: CookieChoice) {
    try {
      window.localStorage.setItem(KEY, choice);
    } catch {
      // Private browsing with storage disabled. The banner closes for this visit and
      // returns next time, which is the correct failure: no record, no assumed consent.
    }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="cookiebar" role="dialog" aria-label="Cookies">
      <div className="cookietext">
        <b>We use a handful of cookies, and only the necessary ones.</b>
        <span>
          They keep you signed in and carry your second factor. There is no advertising and
          nothing that follows you elsewhere. If we ever add analytics, the choice below is
          what we will honour.{" "}
          <Link href="/privacy">How we handle your data</Link>.
        </span>
      </div>
      <div className="cookiebtns">
        <button className="ghost sm" onClick={() => choose("essential")}>
          <X size={13} /> Necessary only
        </button>
        <button className="go sm" onClick={() => choose("all")}>
          <Check size={13} /> Allow all
        </button>
      </div>
    </div>
  );
}
