import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin/session";
import { listFactors } from "@/lib/mfa/store";
import { MfaChallenge } from "../../MfaChallenge";
import { AdminMfaSetup } from "./AdminMfaSetup";

export const metadata: Metadata = { title: "Confirm it is you", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// The operator's second factor. Same rules as a customer's, on the same tables, keyed
// by the admin address rather than a user id.
export default async function AdminVerifyPage() {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");

  const factors = await listFactors({ adminEmail: session.email }, true);

  return (
    <div className="susp">
      {factors.length === 0 ? (
        <AdminMfaSetup />
      ) : (
        <MfaChallenge
          admin
          who={session.email}
          next="/admin"
          factors={factors.map((f) => ({ id: f.id, kind: f.kind, label: f.label, phone: f.phone }))}
        />
      )}
    </div>
  );
}
