// Official profile links. Brand glyphs are filled marks (not the stroke-based set
// in icons.tsx) because each platform's logo is only recognisable in its filled
// form, and a stroked approximation reads as a knock-off.
//
// Every link opens in a new tab with rel="noreferrer" so the destination cannot
// reach back through window.opener, and carries an aria-label because the anchor
// has no text content.

type GlyphProps = { size?: number };

function Glyph({ size = 18, children }: GlyphProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const Facebook = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.52 1.49-3.91 3.77-3.91 1.09 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.78-1.63 1.57v1.88h2.78l-.44 2.91h-2.34V22C18.34 21.24 22 17.08 22 12.06z" />
  </Glyph>
);

const Instagram = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M12 2c2.72 0 3.06.01 4.12.06 1.07.05 1.79.22 2.43.47.66.25 1.22.59 1.78 1.15.56.56.9 1.12 1.15 1.78.25.64.42 1.36.47 2.43.05 1.06.06 1.4.06 4.11s-.01 3.05-.06 4.11c-.05 1.07-.22 1.79-.47 2.43-.25.66-.59 1.22-1.15 1.78-.56.56-1.12.9-1.78 1.15-.64.25-1.36.42-2.43.47-1.06.05-1.4.06-4.12.06s-3.06-.01-4.12-.06c-1.07-.05-1.79-.22-2.43-.47a4.9 4.9 0 0 1-1.78-1.15 4.9 4.9 0 0 1-1.15-1.78c-.25-.64-.42-1.36-.47-2.43C2.01 15.05 2 14.71 2 12s.01-3.05.06-4.11c.05-1.07.22-1.79.47-2.43.25-.66.59-1.22 1.15-1.78A4.9 4.9 0 0 1 5.46 2.53c.64-.25 1.36-.42 2.43-.47C8.95 2.01 9.29 2 12 2zm0 1.8c-2.67 0-2.99.01-4.04.06-.98.04-1.5.2-1.86.34-.47.18-.8.4-1.15.75-.35.35-.57.68-.75 1.15-.14.36-.3.88-.34 1.85-.05 1.06-.06 1.37-.06 4.05s.01 2.99.06 4.05c.04.97.2 1.49.34 1.85.18.47.4.8.75 1.15.35.35.68.57 1.15.75.36.14.88.3 1.86.34 1.05.05 1.37.06 4.04.06s2.99-.01 4.04-.06c.98-.04 1.5-.2 1.86-.34.47-.18.8-.4 1.15-.75.35-.35.57-.68.75-1.15.14-.36.3-.88.34-1.85.05-1.06.06-1.37.06-4.05s-.01-2.99-.06-4.05c-.04-.97-.2-1.49-.34-1.85a3.1 3.1 0 0 0-.75-1.15 3.1 3.1 0 0 0-1.15-.75c-.36-.14-.88-.3-1.86-.34-1.05-.05-1.37-.06-4.04-.06zm0 3.07a5.13 5.13 0 1 1 0 10.26 5.13 5.13 0 0 1 0-10.26zm0 8.46a3.33 3.33 0 1 0 0-6.66 3.33 3.33 0 0 0 0 6.66zm6.54-8.66a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 0 1 2.4 0z" />
  </Glyph>
);

const LinkedIn = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.55C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.72C24 .77 23.2 0 22.22 0z" />
  </Glyph>
);

const TikTok = (p: GlyphProps) => (
  <Glyph {...p}>
    <path d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5 2.59 2.59 0 0 1 0-5.18c.27 0 .52.04.76.12v-3.2a5.9 5.9 0 0 0-.76-.05A5.68 5.68 0 0 0 4.19 15.3 5.68 5.68 0 0 0 9.86 21a5.68 5.68 0 0 0 5.68-5.68V9.01a7.35 7.35 0 0 0 4.27 1.37V7.3a4.25 4.25 0 0 1-3.21-1.48z" />
  </Glyph>
);

export const SOCIAL_LINKS = [
  { name: "Facebook", href: "https://www.facebook.com/profile.php?id=61592608816917", Icon: Facebook },
  { name: "Instagram", href: "https://www.instagram.com/freshleads.io", Icon: Instagram },
  { name: "LinkedIn", href: "https://www.linkedin.com/company/fresh-leads-io/", Icon: LinkedIn },
  { name: "TikTok", href: "https://www.tiktok.com/@user9681151755007", Icon: TikTok },
] as const;

export function SocialLinks({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <ul className={`social-links ${className ?? ""}`}>
      {SOCIAL_LINKS.map(({ name, href, Icon }) => (
        <li key={name}>
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={name}
            title={name}
            className="social-link"
          >
            <Icon size={size} />
          </a>
        </li>
      ))}
    </ul>
  );
}
