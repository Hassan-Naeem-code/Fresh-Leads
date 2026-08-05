-- THE TEAM POLICIES REFERRED TO THEMSELVES
--
-- Found by attacking the running system, which is the only way either of the last two
-- serious holes was found either.
--
--   create policy org_members_read on public.org_members
--     using (org_id in (select org_id from public.org_members where user_id = auth.uid()));
--
-- Reading org_members runs the policy, the policy reads org_members, and Postgres stops
-- it with 42P17 infinite recursion. Every browser read of either table returned a 500,
-- including a member simply looking at their own team.
--
-- It failed CLOSED, so nothing leaked and nobody could see another team. The product
-- kept working because every server route reads through the service role, which is not
-- subject to policies at all, and that is exactly why a test through the app did not
-- catch it. It took a request made the way a browser makes one.
--
-- The fix is the standard one: ask the question in a SECURITY DEFINER function, which
-- reads the table without re-entering its policy.

create or replace function public.my_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.org_members where user_id = auth.uid();
$$;

-- Callable by a signed-in browser, which is the whole point: it answers only "which
-- team am I in", takes no arguments, and cannot be pointed at anybody else.
grant execute on function public.my_org_id() to authenticated;

drop policy if exists org_members_read on public.org_members;
create policy org_members_read on public.org_members
  for select to authenticated
  using (org_id = public.my_org_id());

drop policy if exists organisations_read on public.organisations;
create policy organisations_read on public.organisations
  for select to authenticated
  using (id = public.my_org_id());

-- The write revocations from 025 stand and are deliberately restated, because a policy
-- that grants SELECT says nothing whatever about the other verbs, which is the exact
-- shape of the hole migration 021 had to close on profiles.
revoke insert, update, delete on public.organisations from anon, authenticated;
revoke insert, update, delete on public.org_members from anon, authenticated;
revoke all on public.org_invites from anon, authenticated;
