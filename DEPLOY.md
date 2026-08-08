# Deploying Fresh Leads

Everything needed to take this from a clone to a live site. The README covers what the
product does and how to run it locally; this covers putting it in front of customers.

Order matters: the database has to exist before the app can start, and Stripe has to be
able to reach the app before anyone can pay.

## 1. Create the Supabase project

1. Start a project at [supabase.com](https://supabase.com) and pick a region near your
   customers.
2. Open **Project Settings, API** and copy three values:
   - Project URL, for `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key, for `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` secret, for `SUPABASE_SERVICE_ROLE_KEY`

The service role key bypasses row level security. It is server only and must never be
prefixed `NEXT_PUBLIC_`.

## 2. Run the migrations

In the Supabase SQL editor, run these in order. Each is safe to run twice.

| File | What it adds |
| --- | --- |
| `supabase/schema.sql` | Base tables and row level security |
| `002_admin_branding.sql` | Site settings and logo storage |
| `003_admin_accounts.sql` | The single admin credential |
| `004_contact_messages.sql` | Contact form inbox |
| `005_atomic_quota.sql` | Lead indexes |
| `006_credits_and_subscription.sql` | Credits, unlocks, subscriptions, and the SQL functions that move them |
| `007_buyer_profile.sql` | Saved buyer profile |
| `008_business_snapshots.sql` | Dated crawl observations, for change detection |
| `009_watchlists.sql` | Watched markets |
| `010_owner_unlocks.sql` | Owner reveals |
| `011_api_keys.sql` | API keys |
| `012_spend_credits.sql` | The general credit charge used by bulk enrichment |
| `013_crm_connections.sql` | HubSpot and Salesforce connections |
| `014_email_sequences.sql` | Outreach sequences |
| `015_crm_instance_url.sql` | Salesforce instance URL |
| `016_support_and_preferences.sql` | Support tickets and notification preferences |
| `017_suspension_and_audit.sql` | Account suspension and the operator audit log |
| `018_mfa.sql` | Second factor enrolment and challenges |
| `019_triggers.sql` | Change triggers derived from snapshots |
| `020_rate_limits.sql` | The shared rate limiter's counters |
| `021_lock_down_profiles.sql` | Tightens row level security on profiles |
| `022_search_cache.sql` | Cached discovery and website audits |
| `023_hiring_signals.sql` | Remembered hiring facts |
| `024_session_epoch.sql` | Sign-out-everywhere |
| `025_teams.sql` | Shared balances and team membership |
| `026_fix_team_policies.sql` | Corrects the team policies in 025 |
| `027_team_handover.sql` | Transferring ownership of a team |
| `028_seats.sql` | Per-seat billing |
| `029_newsletter.sql` | Double opt-in newsletter list |
| `030_webhooks.sql` | Outbound webhooks |
| `031_lead_reports.sql` | Bad-lead reports and the automatic credit back |
| `032_quality_samples.sql` | Measured accuracy, the numbers published at `/accuracy` |
| `033_search_metrics.sql` | Per-search timings, so reliability can be measured |
| `034_icp_criteria.sql` | Saved ideal-customer criteria, so they survive a reload |
| `035_sample_searches.sql` | Cache for the public sample search on the landing page |
| `036_business_index.sql` | The owned business index, and the areas it covers |

After 036, build the index itself. It is a tool rather than a cron because it runs for
tens of minutes against a free public API and needs to be resumable by hand:

```
node test/tools/ingest-metros.mjs            # all 20 metros, skipping fresh ones
node test/tools/ingest-metros.mjs austin     # one metro
```

Nothing breaks before you run it. An area the index does not cover falls through to the
live sources exactly as the product behaved before the index existed, so ingesting is a
speed and reliability upgrade rather than a switch that has to be thrown.

Migration 006 is the important one. Balances, unlocks and subscriptions all live there,
and the guarantees that protect revenue (never charge twice for the same business, never
let a balance go negative, never double grant a redelivered webhook) are enforced by
those SQL functions rather than by application code.

## 3. Allow sign ups

In **Authentication, Providers**, enable Email. Turn **Confirm email** off if you want
people searching within seconds of signing up; leave it on if you would rather verify
addresses first. Everything else works either way.

## 4. Deploy to Vercel

Import the repository, then add the environment variables below in **Settings,
Environment Variables**. Local and production are separate: a key in `.env.local` is not
in Vercel until you put it there, and forgetting one is the most common way a feature
silently stops working in production.

**Required**

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | From step 1 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From step 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only |
| `NEXT_PUBLIC_SITE_URL` | Your canonical URL, used for Stripe redirects |

**Payments**

| Variable | Notes |
| --- | --- |
| `STRIPE_SECRET_KEY` | Test key until you are ready to charge real cards |
| `STRIPE_WEBHOOK_SECRET` | From step 5 |

**Optional, each degrades gracefully when absent**

| Variable | Without it |
| --- | --- |
| `GOOGLE_PLACES_API_KEY` | OpenStreetMap only: lower coverage, no ratings or review counts |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Phone numbers are format checked offline, not dialled |
| `ZEROBOUNCE_API_KEY` | Email is syntax and MX checked only |
| `HUNTER_API_KEY` | Owner lookup falls back to crawling the business's own site |
| `CLAUDE_API_KEY` | The ideal customer box uses keyword matching instead of AI |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Bootstrap credentials for a fresh admin account |
| `ADMIN_SESSION_SECRET` | Defaults to the service role key |

A password containing `#` must be quoted, or dotenv reads everything after the `#` as a
comment.

## 5. Connect Stripe

1. In the Stripe dashboard create an event destination pointing at
   `https://your-domain/api/webhooks/stripe`.
2. Subscribe it to these five events:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `invoice.paid`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
3. Copy the signing secret into `STRIPE_WEBHOOK_SECRET` and redeploy.

The webhook is the only place access is granted. The success page is presentation; the
webhook is truth. It answers 500 on transient failures so Stripe keeps retrying, which
is deliberate: a database blip must not leave a paying customer with nothing.

**Test it before launch.** Buy credits with card `4242 4242 4242 4242`. A purchase of
100 credits should land as 110, because baskets of 100 or more earn bonus credits.

## 6. Set up the admin panel

`/admin` has its own login, separate from customer accounts. There is one admin and no
sign up.

1. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in Vercel and redeploy.
2. Sign in once at `/admin/login`. Those credentials are then written to the database.
3. Change the password at `/admin/account`. From that point the environment variables
   are only a fallback for an empty database.

Sections: overview, customers and their access, branding (name, logo and palette,
applied live without a redeploy), the contact form inbox, and account settings.

## 7. Point Supabase at the live URL

In **Authentication, URL Configuration**, set the Site URL to your domain and add
`https://your-domain/auth/callback` to the redirect list, or sign in links will send
people to localhost.

## After launch

- **Watch the Stripe webhook deliveries** for the first few payments. A 500 there means a
  customer paid and did not receive what they bought. Stripe will retry, but you want to
  see it happen.
- **Change detection needs time.** Crawl snapshots accumulate from real searches, and no
  "what changed" signal can appear until a business has been seen twice.
- **Rotate any key that has ever been pasted somewhere shared.** Supabase, Stripe and the
  data vendors all support rotation without downtime.
