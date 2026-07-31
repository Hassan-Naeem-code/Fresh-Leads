"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, Clock, Coin } from "../icons";

// The signed-in navigation, as a left rail rather than a top strip.
//
// The header is kept to identity and balance only, so the app reads as a workspace:
// sections on the left, whatever you picked filling the space on the right. It also
// leaves room to add sections without the header running out of width.

const LINKS = [
  { href: "/dashboard", label: "Search", icon: Search, exact: true },
  { href: "/dashboard/history", label: "History", icon: Clock, exact: false },
  { href: "/dashboard/billing", label: "Billing", icon: Coin, exact: false },
];

export function SideNav() {
  const pathname = usePathname();

  return (
    <nav className="sidenav" aria-label="Sections">
      {LINKS.map(({ href, label, icon: Icon, exact }) => {
        // "Search" lives at the dashboard root, so it has to match exactly or it
        // would light up on every page underneath it.
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`sidelink ${active ? "on" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={16} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
