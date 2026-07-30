# Credit-system SQL tests

These exercise `supabase/006_credits_and_subscription.sql` against a real
PostgreSQL, because the no-double-charge guarantees live in SQL (unique indexes and
conditional UPDATEs), not in TypeScript. Testing them any other way would only be
testing a mock.

## Run

Needs a local `postgres`/`initdb` on PATH (`brew install postgresql@16`):

    ./test/sql/run.sh

It starts a throwaway cluster in a temp dir, applies `harness.sql` (a minimal
stand-in for the Supabase tables migration 006 depends on: `auth.users`,
`profiles`, `searches`, `leads`), applies the migration, runs `credits.test.sql`,
then tears the cluster down. It never touches your Supabase database.

## What is covered

- The signup bonus and Stripe purchases are idempotent, so a redelivered webhook
  cannot grant credits twice.
- An unlock spends exactly one credit, and re-unlocking the same business is free
  forever.
- Export charges only for the leads still locked, charges duplicates once, and is
  refused outright (not partially) when the user cannot afford the whole batch.
- A balance can never go negative, enforced by a CHECK constraint.
- The ledger always reconciles against the balance.
- An out-of-order subscription webhook cannot shorten access already paid for.
