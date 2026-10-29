-- Run only in the intended learning project's SQL Editor after review.
-- Scope: public.training_user_notes only. Preserve rows, RLS and service_role grants.
begin;
revoke all privileges on table public.training_user_notes
from PUBLIC, anon, authenticated;

do $$
declare
  columns_sql text;
begin
  select string_agg(format('%I', attname), ', ' order by attnum)
    into columns_sql
  from pg_attribute
  where attrelid = 'public.training_user_notes'::regclass
    and attnum > 0 and not attisdropped;
  execute format(
    'revoke all privileges (%s) on table public.training_user_notes from PUBLIC, anon, authenticated',
    columns_sql
  );
end;
$$;
commit;

-- Run these read-only checks before and after applying the transaction above.
-- Expected after: anon/authenticated false, service_role CRUD true.
select r.role_name, p.privilege,
  has_table_privilege(r.role_name, 'public.training_user_notes', p.privilege) as table_allowed
from (values ('anon'), ('authenticated'), ('service_role')) r(role_name)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(privilege)
order by 1, 2;

-- Expected after: all false (includes table-level and column-level access).
select r.role_name, p.privilege,
  has_any_column_privilege(r.role_name, 'public.training_user_notes', p.privilege) as column_allowed
from (values ('anon'), ('authenticated')) r(role_name)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) p(privilege)
order by 1, 2;

-- Expected after: zero PUBLIC table/column grants.
select 'table' as scope, x.privilege_type
from pg_class c cross join lateral aclexplode(c.relacl) x
where c.oid = 'public.training_user_notes'::regclass and x.grantee = 0
union all
select a.attname::text, x.privilege_type
from pg_attribute a cross join lateral aclexplode(a.attacl) x
where a.attrelid = 'public.training_user_notes'::regclass
  and a.attnum > 0 and not a.attisdropped and x.grantee = 0;
