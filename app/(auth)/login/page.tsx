import type { Metadata } from "next";
import { getSiteSettings } from "@/lib/site-settings.server";
import { LoginForm } from "./LoginForm";

// Private, signed-in surface. robots.txt disallows the path, but a page-level
// noindex is what actually keeps it out of the index if the URL is ever shared.
export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  const settings = await getSiteSettings();
  return <LoginForm settings={settings} />;
}
