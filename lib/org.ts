import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "./supabase/admin";

// Teams.
//
// The whole design rests on one idea: a team does not get a second money system, it
// gets a BILLING OWNER. Every member's spending resolves to one user id, so the credit
// balance, the no-double-charge unique index on lead_unlocks, the ledger and the
// subscription all keep working exactly as they were written, and a shared pool,
// shared unlocked leads and one subscription for the team fall out of that for free.
//
// The rule that must never be broken: MONEY RESOLVES TO THE OWNER, PERMISSIONS RESOLVE
// TO THE PERSON. Charging the person breaks the shared pool; asking the owner for
// permission would let any member do anything the owner can.

export type OrgRole = "owner" | "admin" | "member";

export type Membership = {
  orgId: string;
  orgName: string;
  ownerUserId: string;
  role: OrgRole;
};

export type Member = {
  userId: string;
  email: string;
  role: OrgRole;
  joinedAt: string;
};

/** Days an invite link stays usable. Long enough to survive a holiday, short enough
 *  that a forwarded email is not a standing key to somebody's credit balance. */
const INVITE_TTL_DAYS = 14;

/** The team this person belongs to, or null for the overwhelming majority who do not. */
export async function membershipOf(userId: string): Promise<Membership | null> {
  try {
    const { data } = await createAdminClient()
      .from("org_members")
      .select("role, org_id, organisations(id, name, owner_user_id)")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data?.organisations) return null;

    const org = data.organisations as unknown as {
      id: string; name: string; owner_user_id: string;
    };
    return {
      orgId: org.id,
      orgName: org.name,
      ownerUserId: org.owner_user_id,
      role: data.role as OrgRole,
    };
  } catch {
    return null;
  }
}

/**
 * Whose balance a spend comes out of.
 *
 * Falls back to the person themselves, which is both the answer for every account that
 * has never touched teams AND the safe direction to fail in: a lookup that breaks
 * charges someone their own credit instead of silently spending a colleague's.
 */
export async function billingUser(userId: string): Promise<string> {
  const membership = await membershipOf(userId);
  return membership?.ownerUserId ?? userId;
}

/** Everyone in the team, with the email addresses only the admin client can read. */
export async function membersOf(orgId: string): Promise<Member[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("org_members")
    .select("user_id, role, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (!data?.length) return [];

  // auth.users is not joinable from PostgREST, so the addresses come from the admin
  // API. Batched by page rather than one call per member.
  const emails = new Map<string, string>();
  try {
    const { data: page } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of page?.users ?? []) if (u.email) emails.set(u.id, u.email);
  } catch {
    // A missing address is cosmetic. Showing a member with no email beats failing the
    // whole page and leaving somebody unable to manage their team.
  }

  return data.map((row) => ({
    userId: row.user_id as string,
    email: emails.get(row.user_id as string) ?? "",
    role: row.role as OrgRole,
    joinedAt: row.created_at as string,
  }));
}

/** Create a team around one person, who becomes its billing owner. */
export async function createOrg(
  userId: string,
  name: string
): Promise<{ ok: true; orgId: string } | { ok: false; error: string }> {
  const admin = createAdminClient();

  // One team per person. Without this, "whose money is this?" stops having a single
  // answer and every spend needs to know which hat somebody is wearing.
  if (await membershipOf(userId)) {
    return { ok: false, error: "You are already in a team. Leave it before starting another." };
  }

  const clean = name.trim().slice(0, 80);
  if (clean.length < 2) return { ok: false, error: "Give the team a name." };

  const { data, error } = await admin
    .from("organisations")
    .insert({ name: clean, owner_user_id: userId })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Could not create the team." };

  const { error: memberError } = await admin
    .from("org_members")
    .insert({ org_id: data.id, user_id: userId, role: "owner" });
  if (memberError) {
    // Roll back rather than leaving a team with a billing owner who is not in it: the
    // credits would be spendable by nobody and visible to nobody.
    await admin.from("organisations").delete().eq("id", data.id);
    return { ok: false, error: "Could not create the team." };
  }

  return { ok: true, orgId: data.id as string };
}

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/**
 * Invite somebody. Returns the RAW token exactly once, for the link.
 *
 * Stored hashed, like an API key, because an invite link is a credential: it joins the
 * holder to a team whose shared balance they can then spend.
 */
export async function inviteToOrg(
  orgId: string,
  email: string,
  role: "admin" | "member",
  invitedBy: string
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const clean = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return { ok: false, error: "That email does not look right." };

  const token = randomBytes(32).toString("base64url");
  const { error } = await createAdminClient().from("org_invites").insert({
    org_id: orgId,
    email: clean,
    role,
    token_hash: hashToken(token),
    invited_by: invitedBy,
    expires_at: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString(),
  });
  if (error) return { ok: false, error: "Could not create that invite." };
  return { ok: true, token };
}

/**
 * Redeem an invite.
 *
 * Checked against the SIGNED-IN user, not against whoever the invite was addressed to,
 * and the two must match. An invite link that joined whoever opened it would be a way
 * to attach yourself to a stranger's credit balance by finding one forwarded email.
 */
export async function acceptInvite(
  token: string,
  userId: string,
  userEmail: string
): Promise<{ ok: true; orgId: string; orgName: string } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data: invite } = await admin
    .from("org_invites")
    .select("id, org_id, email, role, expires_at, accepted_at, organisations(name)")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (!invite) return { ok: false, error: "That invite link is not valid." };
  if (invite.accepted_at) return { ok: false, error: "That invite has already been used." };
  if (new Date(invite.expires_at as string).getTime() < Date.now()) {
    return { ok: false, error: "That invite has expired. Ask for a new one." };
  }
  if ((invite.email as string).toLowerCase() !== userEmail.trim().toLowerCase()) {
    return { ok: false, error: "That invite was sent to a different email address." };
  }
  if (await membershipOf(userId)) {
    return { ok: false, error: "You are already in a team. Leave it before joining another." };
  }

  const { error } = await admin
    .from("org_members")
    .insert({ org_id: invite.org_id, user_id: userId, role: invite.role });
  if (error) return { ok: false, error: "Could not join that team." };

  // Marked used only AFTER the membership exists. The other order would burn the
  // invite on a failed join and leave somebody with a dead link and no team.
  await admin.from("org_invites").update({ accepted_at: new Date().toISOString() }).eq("id", invite.id);

  const org = invite.organisations as unknown as { name?: string } | null;
  return { ok: true, orgId: invite.org_id as string, orgName: org?.name ?? "your team" };
}

/**
 * Remove somebody from a team.
 *
 * The billing owner cannot be removed, by anyone, including themselves. Their profile
 * IS the shared balance and their subscription IS the team's access, so removing them
 * would leave a team spending money that no longer has an owner. Handing the team over
 * or closing it are separate, deliberate acts.
 */
export async function removeMember(
  orgId: string,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organisations")
    .select("owner_user_id")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) return { ok: false, error: "That team no longer exists." };
  if (org.owner_user_id === userId) {
    return {
      ok: false,
      error: "The owner holds the team's credits and everything it has opened. Hand the team over first, or close it.",
    };
  }

  const { error } = await admin.from("org_members").delete().eq("org_id", orgId).eq("user_id", userId);
  return error ? { ok: false, error: "Could not remove them." } : { ok: true };
}

/** Change what somebody may do. The owner's own role is not a thing anyone may edit. */
export async function setRole(
  orgId: string,
  userId: string,
  role: "admin" | "member"
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organisations")
    .select("owner_user_id")
    .eq("id", orgId)
    .maybeSingle();
  if (org?.owner_user_id === userId) {
    return { ok: false, error: "The owner's role cannot be changed." };
  }

  const { error } = await admin
    .from("org_members")
    .update({ role })
    .eq("org_id", orgId)
    .eq("user_id", userId);
  return error ? { ok: false, error: "Could not change that role." } : { ok: true };
}

/**
 * Hand the team to somebody else who is already in it.
 *
 * The whole move is one SQL function, which is one transaction, because the billing
 * owner is not a label: their profile IS the balance and their user id IS the key on
 * every lead the team has ever paid to open. Pointing the team at a new owner without
 * moving those would drop the shared balance to whatever the new person happens to have
 * and re-lock every business the team already bought.
 *
 * The subscription does not move, and the interface says so before anyone presses the
 * button. Stripe is still billing the old owner's card, and rewriting whose row it is
 * would leave the renewal webhook updating somebody who is not paying.
 */
export async function transferOwnership(
  orgId: string,
  from: string,
  to: string
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await createAdminClient().rpc("transfer_org_ownership", {
    p_org_id: orgId,
    p_from: from,
    p_to: to,
  });
  if (error) return { ok: false, error: "Could not hand the team over." };

  switch (data as string) {
    case "ok":
      return { ok: true };
    case "not_owner":
      return { ok: false, error: "Only the current owner can hand the team over." };
    case "not_a_member":
      return { ok: false, error: "That person is not in this team." };
    case "same_person":
      return { ok: false, error: "They already own it." };
    default:
      return { ok: false, error: "Could not hand the team over." };
  }
}

/**
 * Close a team.
 *
 * Deletes the team and nothing else. The credits and the unlocked leads stay on the
 * owner's account, where they have been the whole time: closing a team is everyone
 * going back to their own account, not anybody losing what they paid for.
 */
export async function closeOrg(
  orgId: string,
  by: string
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await createAdminClient().rpc("close_org", { p_org_id: orgId, p_by: by });
  if (error) return { ok: false, error: "Could not close the team." };
  if (data === "not_owner") return { ok: false, error: "Only the owner can close the team." };
  return data === "ok" ? { ok: true } : { ok: false, error: "Could not close the team." };
}

/** May this role manage people? Money stays with the owner alone. */
export const canManageMembers = (role: OrgRole): boolean => role === "owner" || role === "admin";
export const canManageBilling = (role: OrgRole): boolean => role === "owner";
