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
