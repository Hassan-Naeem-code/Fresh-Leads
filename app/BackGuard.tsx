"use client";
import { useEffect } from "react";

// After a purchase, pressing Back should not walk back into the funnel (Stripe,
// quote, onboarding, signup). We drop a sentinel history entry so the first Back
// press fires popstate, which we catch and redirect into the app instead.
export function BackGuard({ to = "/dashboard" }: { to?: string }) {
  useEffect(() => {
    window.history.pushState(null, "", window.location.href);
    const onPop = () => {
      window.location.replace(to);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [to]);
  return null;
}
