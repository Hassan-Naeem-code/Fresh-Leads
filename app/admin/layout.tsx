import type { Metadata } from "next";

export const metadata: Metadata = { title: "Admin" };

// Pass-through. Guarding and the sidebar live in AdminShell, which the guarded pages
// use, so /admin/verify can render the second factor challenge outside the guard.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
