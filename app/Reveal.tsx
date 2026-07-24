"use client";
import { useEffect, useRef, useState } from "react";

// Scroll-reveal wrapper (Primer-style): fades + slides its children up as they
// enter the viewport. Respects prefers-reduced-motion (shows immediately).
export function Reveal({
  children,
  delay = 0,
  as: Tag = "div",
  className = "",
  immediate = false,
}: {
  children: React.ReactNode;
  delay?: number;
  as?: "div" | "section" | "header" | "li";
  className?: string;
  /** Above-the-fold content. Animates in via pure CSS on first paint instead of
   *  waiting for hydration + an IntersectionObserver, otherwise the hero is a
   *  blank screen until JS lands. */
  immediate?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (immediate) return;
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }
      },
      // Fire early: a fast scroll should never land on a section that is still blank.
      { threshold: 0.01, rootMargin: "0px 0px -4% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const Comp = Tag as React.ElementType;
  if (immediate) {
    return (
      <Comp
        ref={ref}
        className={`enter ${className}`}
        style={delay ? { animationDelay: `${delay}ms` } : undefined}
      >
        {children}
      </Comp>
    );
  }
  return (
    <Comp
      ref={ref}
      className={`reveal ${shown ? "in" : ""} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Comp>
  );
}
