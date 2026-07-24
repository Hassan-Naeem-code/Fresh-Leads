"use client";
import { useEffect, useRef, useState } from "react";

export type HCard = { icon?: React.ReactNode; num?: string; title: string; body: string };

// Primer "Our values" effect: a pinned section where the left title stays put and
// the cards on the right translate horizontally as you scroll down the page.
export function HScrollCards({
  eyebrow,
  title,
  desc,
  cards,
}: {
  eyebrow: string;
  title: string;
  desc: string;
  cards: HCard[];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);

  useEffect(() => {
    const wrap = wrapRef.current;
    const track = trackRef.current;
    if (!wrap || !track) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const update = () => {
      raf = 0;
      if (reduce || window.innerWidth < 820) {
        setX(0);
        return;
      }
      const rect = wrap.getBoundingClientRect();
      const total = wrap.offsetHeight - window.innerHeight; // scrollable distance
      const scrolled = Math.min(Math.max(-rect.top, 0), total);
      const p = total > 0 ? scrolled / total : 0;
      const maxX = Math.max(0, track.scrollWidth - track.clientWidth + 24);
      setX(-p * maxX);
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

  return (
    <section
      ref={wrapRef}
      className="hsc"
      style={{ height: `${100 + cards.length * 48}vh` }}
    >
      <div className="hsc-sticky">
        <div className="hsc-inner pr">
          <div className="hsc-left">
            <span className="pill">{eyebrow}</span>
            <h2 className="pr-h2 hsc-title">{title}</h2>
            <p className="hsc-desc">{desc}</p>
          </div>
          <div className="hsc-viewport">
            <div className="hsc-track" ref={trackRef} style={{ transform: `translate3d(${x}px,0,0)` }}>
              {cards.map((c, i) => (
                <article className="hsc-card" key={i}>
                  <span className="hsc-spine" />
                  <div className="hsc-cardbody">
                    {c.icon && <span className="pr-cardicon">{c.icon}</span>}
                    {c.num && <div className="pr-valuenum">{c.num}</div>}
                    <h3 className="hsc-cardtitle">{c.title}</h3>
                    <p className="hsc-cardtext">{c.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
