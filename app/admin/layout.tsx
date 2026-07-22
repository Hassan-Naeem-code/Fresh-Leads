import type { Metadata } from "next";

export const metadata: Metadata = { title: "Admin" };

// Pass-through. Guarding + the sidebar live in AdminShell (used by the guarded
// pages), so /admin/login can render outside the guard.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
