import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin/session";
import { AdminLoginForm } from "./AdminLoginForm";

export const metadata = { title: "Admin sign in" };

export default async function AdminLoginPage() {
  // Already signed in? Skip the form.
  if (await getAdminSession()) redirect("/admin");
  return <AdminLoginForm />;
}
