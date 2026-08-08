"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gauge, Building, Mail, Info, Check, LifeBuoy, Clock, AlertTriangle } from "../icons";

const LINKS = [
  { href: "/admin", label: "Overview", Icon: Gauge },
  { href: "/admin/users", label: "Users & plans", Icon: Building },
  { href: "/admin/activity", label: "Activity", Icon: Clock },
  { href: "/admin/quality", label: "Quality", Icon: AlertTriangle },
  { href: "/admin/messages", label: "Messages", Icon: Mail },
  { href: "/admin/tickets", label: "Support", Icon: LifeBuoy },
  { href: "/admin/branding", label: "Branding", Icon: Info },
  { href: "/admin/account", label: "Account", Icon: Check },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="adm-nav">
      <span className="adm-navlabel">Manage</span>
      {LINKS.map(({ href, label, Icon }) => {
        // "/admin" is only active on an exact match, every other page lives under it.
        const on = href === "/admin" ? pathname === href : pathname.startsWith(href);
        return (
          <Link key={href} href={href} className={on ? "on" : ""}>
            <Icon size={15} className="icon" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
