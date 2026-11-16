-- Run in the intended project's SQL Editor. Existing tables are preserved.
-- Device approvals: only the server key can read or write; browsers cannot approve themselves.
begin;
create table if not exists public.training_devices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  credential_id text not null unique,
  public_key_spki text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  sign_count bigint not null default 0,
  created_at timestamptz not null default now(),
  approved_at timestamptz
);
create index if not exists training_devices_owner_idx on public.training_devices (owner_id);
alter table public.training_devices enable row level security;
revoke all on public.training_devices from public, anon, authenticated;
grant select, insert, update on public.training_devices to service_role;
notify pgrst, 'reload schema';
commit;

select has_table_privilege('anon', 'public.training_devices', 'select') as anon_can_select,
  has_table_privilege('authenticated', 'public.training_devices', 'select') as authenticated_can_select;

-- Approve one waiting device (run separately after checking the row):
-- select id, owner_id, status, created_at from public.training_devices where status = 'pending' order by created_at;
-- update public.training_devices set status = 'approved', approved_at = now() where id = '<기기 id>' and status = 'pending';
-- Revoke: update public.training_devices set status = 'revoked' where id = '<기기 id>';
