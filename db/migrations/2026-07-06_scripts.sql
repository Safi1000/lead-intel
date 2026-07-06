-- §10 call scripts / email templates — reusable copy reps reference. Org-scoped; managers edit.
create table if not exists scripts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  kind text not null default 'call',
  name text not null,
  body text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists scripts_org_idx on scripts(org_id);
alter table scripts drop constraint if exists scripts_kind_chk;
alter table scripts add constraint scripts_kind_chk check (kind in ('call','email'));
alter table scripts enable row level security;
drop policy if exists scripts_select on scripts;
create policy scripts_select on scripts for select using (is_sa() OR org_id = jwt_org());
drop policy if exists scripts_write on scripts;
create policy scripts_write on scripts for all
  using (is_sa() OR (org_id = jwt_org() AND jwt_role() = 'manager'))
  with check (is_sa() OR (org_id = jwt_org() AND jwt_role() = 'manager'));
