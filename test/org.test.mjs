import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canManageMembers, canManageBilling } from "./.build/org.mjs";

// Teams, and the rules that decide who spends whose money.
//
// The design in one line: a team does not get a second money system, it gets a BILLING
// OWNER, and every member's spending resolves to that one user id. The shared pool, the
// shared unlocked leads and the single subscription all fall out of tables that already
// exist, with no change to a money function that was already proven idempotent.
//
// The rule underneath it: MONEY RESOLVES TO THE OWNER, PERMISSIONS RESOLVE TO THE
// PERSON. Charging the person breaks the shared pool. Asking the owner for permission
// would let any member do anything the owner can.

test("only the owner controls billing, admins do not", () => {
  assert.equal(canManageBilling("owner"), true);
  assert.equal(canManageBilling("admin"), false, "an admin manages people, not the card");
  assert.equal(canManageBilling("member"), false);
});

test("owners and admins manage people, members do not", () => {
  assert.equal(canManageMembers("owner"), true);
  assert.equal(canManageMembers("admin"), true);
  assert.equal(canManageMembers("member"), false, "a member could otherwise invite themselves help");
});

// The rest is enforced in SQL and in the money layer, where a mistake costs real money.
// Checked against the source, because these are the lines that would be easy to
// "simplify" later by somebody who did not know what they were holding up.
const credits = readFileSync("lib/credits.ts", "utf8");
const org = readFileSync("lib/org.ts", "utf8");
const migration = readFileSync("supabase/025_teams.sql", "utf8");

test("every credit path resolves to the wallet, none uses the raw user id", () => {
  // A single missed call site charges a team member personally for a lead their
  // colleagues can already see, or takes a purchase out of the shared pool.
  const rawUserId = credits.match(/p_user_id: userId\b/g) ?? [];
  assert.deepEqual(rawUserId, [], "a money call is still keyed on the acting user");

  // Either spelling is fine: unlock_lead binds the wallet to `payer` first because it
  // needs the same id again to attribute the unlock. What must never appear is the
  // acting user's id going straight into a charge.
  for (const fn of ["grant_credits", "unlock_lead", "unlock_leads_bulk", "spend_credits", "unlock_owner"]) {
    const call = new RegExp(`rpc\\("${fn}",\\s*\\{\\s*\\n?\\s*p_user_id: (await wallet\\(userId\\)|payer)`);
    assert.match(credits, call, `${fn} is not resolved through the wallet`);
  }
  assert.match(credits, /const payer = await wallet\(userId\)/, "payer must itself be the wallet");
});

test("what a team has already opened is read from the wallet too", () => {
  // Otherwise the shared pool charges once and shows the lead as locked to everybody
  // except whoever paid, which is worse than having no team at all.
  const unlockReads = credits.match(/from\("lead_unlocks"\)[\s\S]{0,220}?\.eq\("user_id", ([^)]+)\)/g) ?? [];
  assert.ok(unlockReads.length >= 2, "expected the unlocked-key reads to still be here");
  for (const read of unlockReads) {
    assert.match(read, /await wallet\(userId\)|payer/, `an unlock read is not shared: ${read.slice(0, 60)}`);
  }
});

test("one team per person, enforced by the schema and not by hope", () => {
  // user_id is the PRIMARY KEY on org_members. Two memberships would mean every spend
  // needing to know which hat somebody is wearing, and a wrong guess spends the wrong
  // team's money.
  assert.match(migration, /user_id\s+uuid primary key references auth\.users/);
});

test("the billing owner cannot be removed from their own team", () => {
  // Their profile IS the balance and their subscription IS the access. Removing them
  // leaves a team spending money that no longer has an owner.
  assert.match(org, /owner_user_id === userId/);
  assert.match(org, /cannot be removed/i);
});

test("an invite is stored hashed, like the credential it is", () => {
  assert.match(migration, /token_hash text not null unique/);
  assert.match(org, /token_hash: hashToken\(token\)/);
  assert.doesNotMatch(org, /token: token\b/, "the raw token must never be stored");
});

test("an invite only works for the address it was sent to", () => {
  // A link that joined whoever opened it would let one forwarded email attach a
  // stranger to somebody else's credit balance.
  assert.match(org, /invite\.email as string\)\.toLowerCase\(\) !== userEmail/);
});

test("the browser cannot write any team table", () => {
  // Every write moves the right to spend money. Migration 021 is the standing reminder
  // that a policy saying "your own row" says nothing at all about which columns.
  for (const table of ["organisations", "org_members"]) {
    assert.match(
      migration,
      new RegExp(`revoke insert, update, delete on public\\.${table} from anon, authenticated`),
      `${table} is writable from a browser`
    );
  }
  assert.match(migration, /revoke all on public\.org_invites from anon, authenticated/);
});

test("suspension is not shared, unlike money", () => {
  // A judgement about a person. Inheriting a colleague's suspension, or escaping your
  // own by joining a team, would both be wrong.
  const access = readFileSync("lib/access.ts", "utf8");
  const suspension = access.slice(access.indexOf("suspended_at, suspended_reason"));
  assert.doesNotMatch(suspension.slice(0, 200), /billingUser/);
});

// HANDING A TEAM OVER.
//
// The product already promised this: removing the billing owner answered "transfer the
// team first" and there was no transfer, so an owner could not leave, hand over, or
// wind their team up. An error message pointing at a feature that does not exist is
// worse than a plain refusal.
const handover = readFileSync("supabase/027_team_handover.sql", "utf8");

test("the handover moves the balance and the leads, not just the label", () => {
  // The billing owner is not a label, it IS the wallet: their profile holds the balance
  // and their user id keys every lead the team ever paid to open. Repointing the team
  // without moving those drops the shared balance to whatever the new owner happens to
  // have and re-locks everything the team bought. That is billing twice, by the back
  // door, which is the one thing this product exists not to do.
  assert.match(handover, /update public\.profiles set credits = 0 where id = p_from/);
  assert.match(handover, /update public\.lead_unlocks set user_id = p_to/);
  assert.match(handover, /update public\.owner_unlocks set user_id = p_to/);
});

test("the handover is one function, so it cannot half happen", () => {
  // Four app-level calls could leave the credits moved and the unlocks stranded.
  assert.match(handover, /create or replace function public\.transfer_org_ownership/);
  assert.match(handover, /language plpgsql/);
});

test("moving the balance is written down on both sides", () => {
  // A balance that changes with no ledger entry is how a customer stops trusting the
  // number, and a shared balance is the one people check hardest.
  const entries = handover.match(/insert into public\.credit_ledger[\s\S]{0,200}?'team_transfer'/g) ?? [];
  assert.equal(entries.length, 2, "expected a ledger entry leaving and arriving");
});

test("the unique index that stops double charging is never fought", () => {
  // The new owner may already have opened some of the same businesses. Moving a row
  // onto a key they already hold would collide with the no-double-charge index.
  assert.match(handover, /lead_key not in \(select lead_key from public\.lead_unlocks where user_id = p_to\)/);
});

test("the subscription deliberately does not move", () => {
  // Stripe is still billing the old owner's card. Rewriting whose row it is would leave
  // the renewal webhook updating somebody who is not paying.
  assert.match(handover, /SUBSCRIPTION IS DELIBERATELY NOT MOVED/);
  assert.doesNotMatch(handover, /update public\.subscriptions set user_id/);
});

test("closing a team destroys the team and nothing anyone paid for", () => {
  assert.match(handover, /delete from public\.organisations where id = p_org_id/);
  for (const table of ["profiles", "lead_unlocks", "credit_ledger", "leads"]) {
    assert.doesNotMatch(
      handover.slice(handover.indexOf("function public.close_org")),
      new RegExp(`delete from public\\.${table}`),
      `closing a team must not delete ${table}`
    );
  }
});

test("both are the owner's alone, and neither is reachable from a browser", () => {
  const route = readFileSync("app/api/org/route.ts", "utf8");
  assert.match(route, /if \(input\.action === "transfer" \|\| input\.action === "close"\)[\s\S]{0,200}canManageBilling/);
  assert.match(handover, /revoke all on function public\.transfer_org_ownership\(uuid, uuid, uuid\) from public, anon, authenticated/);
  assert.match(handover, /revoke all on function public\.close_org\(uuid, uuid\) from public, anon, authenticated/);
});

test("the refusal no longer points at a feature that does not exist", () => {
  assert.doesNotMatch(org, /Transfer the team first/);
  assert.match(org, /Hand the team over first, or close it/);
});
