import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  listWatchlists, createWatchlist, deleteWatchlist, MAX_WATCHLISTS,
} from "@/lib/watchlists";

// Markets the customer is watching. Reading and managing them costs nothing: a
// watchlist is the reason to come back, so putting it behind a credit would be
// charging for the thing that drives retention.

export const dynamic = "force-dynamic";

/** The signed-in user, or null. Same pattern as the other authenticated routes. */
async function signedInUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

const CreateSchema = z.object({
  niche: z.string().trim().min(1).max(80),
  location: z.string().trim().min(1).max(120),
  playbook: z.string().trim().max(40).nullish(),
  problem: z.string().trim().max(40).nullish(),
  name: z.string().trim().max(80).optional(),
});

export async function GET() {
  const user = await signedInUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ watchlists: await listWatchlists(user.id) });
}

export async function POST(req: Request) {
  const user = await signedInUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Tell us the business type and the area." }, { status: 400 });
  }

  const created = await createWatchlist(user.id, parsed.data);
  if (!created) {
    return NextResponse.json(
      { error: `You can watch up to ${MAX_WATCHLISTS} markets. Remove one to add another.` },
      { status: 409 }
    );
  }
  return NextResponse.json({ watchlist: created });
}

export async function DELETE(req: Request) {
  const user = await signedInUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Which one?" }, { status: 400 });

  const ok = await deleteWatchlist(user.id, id);
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "Could not remove that watchlist." }, { status: 500 });
}
