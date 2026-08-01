-- ---------------------------------------------------------------------------
-- 020. RATE LIMITING THAT SURVIVES SERVERLESS
--
-- There was one rate limiter in the codebase, in memory, guarding the admin login.
-- On Vercel that is per instance: ten concurrent lambdas mean ten separate counters,
-- so an attacker with any concurrency gets ten times the attempts. It is also wiped
-- on every cold start.
--
-- Everything else was unguarded, including three endpoints that cost real money on
-- every call:
--
--   /api/mfa start_sms   sends a text through Twilio. Unlimited, this is SMS pumping
--                        fraud: an attacker points it at premium-rate numbers they
--                        own and bills us for every message.
--   /api/mfa start_email sends mail. Unlimited, this is a mailbomb aimed at anyone
--                        whose address is known, from our domain, which ends with our
--                        sending reputation destroyed.
--   /api/signup          creates accounts, each granted free credits.
--
-- One counter table, checked in Postgres so every instance shares it.
-- ---------------------------------------------------------------------------

create table if not exists public.rate_limits (
  -- "<bucket>:<identifier>", e.g. "mfa_sms:user-uuid" or "signup:203.0.113.9".
  key         text primary key,
  count       integer not null default 0,
  -- Start of the current window. A hit after this plus the window length resets.
  window_from timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists rate_limits_stale_idx on public.rate_limits (updated_at);

alter table public.rate_limits enable row level security;
-- No policies: service role only. A client that could write here could reset its own
-- counter, which is the same as having no limit at all.

-- ---------------------------------------------------------------------------
-- One atomic check-and-increment.
--
-- Done in a single statement on purpose. A read-then-write from the application would
-- race: two requests both read 4, both write 5, and a limit of 5 admits six. The
-- upsert below increments under the row lock, so concurrent callers queue rather than
-- overlap.
-- ---------------------------------------------------------------------------
create or replace function public.hit_rate_limit(
  p_key      text,
  p_max      integer,
  p_window_s integer
)
returns table (allowed boolean, remaining integer, retry_after_s integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_from  timestamptz;
begin
  insert into public.rate_limits (key, count, window_from, updated_at)
  values (p_key, 1, now(), now())
  on conflict (key) do update
    set
      -- Expired window: start again at one. Otherwise add to the tally.
      count = case
        when public.rate_limits.window_from < now() - make_interval(secs => p_window_s)
        then 1
        else public.rate_limits.count + 1
      end,
      window_from = case
        when public.rate_limits.window_from < now() - make_interval(secs => p_window_s)
        then now()
        else public.rate_limits.window_from
      end,
      updated_at = now()
  returning public.rate_limits.count, public.rate_limits.window_from
  into v_count, v_from;

  return query select
    v_count <= p_max,
    greatest(0, p_max - v_count),
    case
      when v_count <= p_max then 0
      else greatest(1, ceil(extract(epoch from (v_from + make_interval(secs => p_window_s)) - now()))::integer)
    end;
end;
$$;

revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;

-- Housekeeping. A key nobody has touched in a day cannot be inside any window we use.
create or replace function public.purge_stale_rate_limits()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare removed integer;
begin
  delete from public.rate_limits where updated_at < now() - interval '1 day';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_stale_rate_limits() from public, anon, authenticated;
