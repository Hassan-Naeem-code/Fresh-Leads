import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/api-keys";

// Managing API keys. Creating and revoking go through the server rather than the
// browser writing to the table directly, because minting a credential and revoking one
// are both security actions and neither should be reachable from a client.

export const dynamic = "force-dynamic";

async function signedInUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await signedInUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ keys: await listApiKeys(user.id) });
}

export async function POST(req: Request) {
  const user = await signedInUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = z.object({ label: z.string().trim().max(60).optional() })
    .safeParse(await req.json().catch(() => ({})));
  const created = await createApiKey(user.id, parsed.success ? (parsed.data.label ?? "") : "");
  if (!created) return NextResponse.json({ error: "Could not create a key." }, { status: 500 });

  // The only time the secret is ever returned. After this it exists as a hash.
  return NextResponse.json({ key: created.key, record: created.record });
}

export async function DELETE(req: Request) {
  const user = await signedInUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Which key?" }, { status: 400 });
  const ok = await revokeApiKey(user.id, id);
  return ok ? NextResponse.json({ ok: true })
            : NextResponse.json({ error: "Could not revoke that key." }, { status: 500 });
}
