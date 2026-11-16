-- Run in the intended project's SQL Editor. Existing notes and other tables are preserved.
-- Before running, replace B_TEST_EMAIL below with test account B's login email (in the editor only, never commit it).
-- Private backup copy: only the server key can read it; browsers and logged-in users cannot.
begin;
create table if not exists public.training_note_backups (
  id uuid primary key,
  owner_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) <= 10000),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.training_note_backups enable row level security;
revoke all on public.training_note_backups from public, anon, authenticated;
grant select on public.training_note_backups to service_role;

-- Restore target: one virtual note of test account B. Hash = SHA-256 of title + newline + body (UTF-8).
with b as (select id from auth.users where email = 'B_TEST_EMAIL'),
note as (select 'b10c0000-0000-4000-8000-0000000000b1'::uuid as id,
  '10단계 복구 대상 가상 메모'::text as title, 'B 계정의 복구 시험용 가상 메모입니다.'::text as body)
insert into public.training_note_backups (id, owner_id, title, body, content_sha256)
select note.id, b.id, note.title, note.body,
  encode(sha256(convert_to(note.title || E'\n' || note.body, 'UTF8')), 'hex')
from note, b
on conflict (id) do nothing;

-- The same note in the live table, so it can be damaged and restored during the test.
insert into public.training_user_notes (id, owner_id, title, body)
select id, owner_id, title, body from public.training_note_backups
where id = 'b10c0000-0000-4000-8000-0000000000b1'
on conflict (id) do nothing;
notify pgrst, 'reload schema';
commit;

-- Expect exactly 1 backup row owned by B and anon/authenticated without select.
select count(*) as backup_rows,
  has_table_privilege('anon', 'public.training_note_backups', 'select') as anon_can_select,
  has_table_privilege('authenticated', 'public.training_note_backups', 'select') as authenticated_can_select
from public.training_note_backups where id = 'b10c0000-0000-4000-8000-0000000000b1';
