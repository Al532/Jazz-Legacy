begin;

create table public.library_entries (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (octet_length(id) between 1 and 1200),
  value jsonb check (value is null or octet_length(value::text) <= 8192),
  primary key (user_id, id)
);

alter table public.library_entries enable row level security;
revoke all on table public.library_entries from public, anon, authenticated;
grant select, insert, update on table public.library_entries to authenticated;

create policy "Read own library" on public.library_entries
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert into own library" on public.library_entries
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own library" on public.library_entries
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create schema jazz_private;
revoke all on schema jazz_private from public, anon, authenticated;
grant usage on schema jazz_private to authenticated;

create function jazz_private.delete_current_user()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  subject_id uuid := auth.uid();
  active_session uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if subject_id is null or active_session is null or not exists (
    select 1 from auth.sessions where id = active_session and user_id = subject_id
  ) then
    raise exception 'An active session is required' using errcode = '42501';
  end if;

  delete from auth.users where id = subject_id;
end;
$$;

revoke all on function jazz_private.delete_current_user() from public, anon, authenticated;
grant execute on function jazz_private.delete_current_user() to authenticated;

create function public.delete_my_jazz_account()
returns void
language sql
security invoker
set search_path = ''
as $$
  select jazz_private.delete_current_user();
$$;

revoke all on function public.delete_my_jazz_account() from public, anon, authenticated;
grant execute on function public.delete_my_jazz_account() to authenticated;

commit;
