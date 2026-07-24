"use client";
import { useEffect, useRef, useState } from "react";

// Primer-style "color comes through the text on scroll": each word fades from
// dim to solid as the block scrolls through the viewport, left-to-right.
export function ScrollText({ text, className = "" }: { text: string; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [p, setP] = useState(0);
  const words = text.split(" ");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setP(1);
      return;
    }
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // 0 when the block sits low in the viewport, 1 once it's scrolled up past centre.
      const prog = (0.82 * vh - r.top) / (0.42 * vh + r.height);
      setP(Math.max(0, Math.min(1, prog)));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const spread = 4; // how many words fade at once (soft leading edge)
  const wp = p * (words.length + spread);

  return (
    <h2 ref={ref} className={`scrolltext ${className}`} aria-label={text}>
      {words.map((w, i) => {
        const o = Math.max(0.14, Math.min(1, (wp - i) / spread));
        return (
          <span key={i} aria-hidden="true" style={{ opacity: o }}>
            {w}
            {i < words.length - 1 ? " " : ""}
          </span>
        );
      })}
    </h2>
  );
}
