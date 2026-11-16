-- Run in the intended project's SQL Editor. Existing note tables are preserved.
-- Notices are a separate resource from training_user_notes; only the server reads them.
begin;
create table if not exists public.training_instructor_notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) <= 10000),
  created_at timestamptz not null default now()
);
alter table public.training_instructor_notices enable row level security;
revoke all on public.training_instructor_notices from public, anon, authenticated;
grant select on public.training_instructor_notices to service_role;
notify pgrst, 'reload schema';
-- No write API: the contract has no instructor role, so notices are added here in the SQL Editor.
commit;

select relrowsecurity as rls_enabled,
  has_table_privilege('anon', 'public.training_instructor_notices', 'select') as anon_can_select,
  has_table_privilege('authenticated', 'public.training_instructor_notices', 'select') as authenticated_can_select
from pg_class where oid = 'public.training_instructor_notices'::regclass;
