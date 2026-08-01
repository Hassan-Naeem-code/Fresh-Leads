"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, Clock, Coin, Upload, Key, Building, Mail, Lock } from "../icons";

// The signed-in navigation, as a left rail rather than a top strip.
//
// The header is kept to identity and balance only, so the app reads as a workspace:
// sections on the left, whatever you picked filling the space on the right. It also
// leaves room to add sections without the header running out of width.
//
// Sections marked `paid` are what the yearly fee buys. On a trial account they stay
// visible and lead to billing rather than disappearing, because a section you cannot
// see is a section you never buy. The pages enforce the same rule server-side.

const LINKS = [
  { href: "/dashboard", label: "Search", icon: Search, exact: true, paid: false },
  { href: "/dashboard/history", label: "History", icon: Clock, exact: false, paid: true },
  { href: "/dashboard/enrich", label: "Enrich a list", icon: Upload, exact: false, paid: true },
  { href: "/dashboard/billing", label: "Billing", icon: Coin, exact: false, paid: false },
  { href: "/dashboard/email", label: "Email", icon: Mail, exact: false, paid: true },
  { href: "/dashboard/crm", label: "CRM", icon: Building, exact: false, paid: true },
  { href: "/dashboard/api", label: "API keys", icon: Key, exact: false, paid: true },
];

export function SideNav({ canUseTools }: { canUseTools: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="sidenav" aria-label="Sections">
      {LINKS.map(({ href, label, icon: Icon, exact, paid }) => {
        const locked = paid && !canUseTools;
        // "Search" lives at the dashboard root, so it has to match exactly or it
        // would light up on every page underneath it.
        const active = !locked && (exact ? pathname === href : pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={locked ? "/dashboard/billing" : href}
            className={`sidelink ${active ? "on" : ""} ${locked ? "locked" : ""}`}
            aria-current={active ? "page" : undefined}
            title={locked ? "Included with the yearly plan" : undefined}
          >
            <Icon size={16} />
            <span>{label}</span>
            {locked && <Lock size={13} className="sidelock" />}
          </Link>
        );
      })}
    </nav>
  );
}
