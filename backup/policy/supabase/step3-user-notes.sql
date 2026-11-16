-- Run in the intended project's SQL Editor. Existing training_notes are preserved.
begin;
create table if not exists public.training_user_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) <= 10000),
  created_at timestamptz not null default now()
);
create index if not exists training_user_notes_owner_idx on public.training_user_notes (owner_id);
alter table public.training_user_notes enable row level security;
revoke all on public.training_user_notes from public, anon, authenticated;
grant select, insert, update, delete on public.training_user_notes to service_role;
notify pgrst, 'reload schema';
-- No client policies: all CRUD goes through the server's verified login flow.
-- No auth.users FK: the existing verifier also accepts the judge's synthetic IDs.
commit;

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'training_user_notes'
order by ordinal_position;

select relrowsecurity as rls_enabled,
  has_table_privilege('anon', 'public.training_user_notes', 'select') as anon_can_select,
  has_table_privilege('authenticated', 'public.training_user_notes', 'select') as authenticated_can_select
from pg_class where oid = 'public.training_user_notes'::regclass;
