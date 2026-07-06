-- ===== Targets (§8) — blended revenue + closes, per level/period. Versioned: a change = a new row. =====
create table if not exists targets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  level text not null,          -- 'org' | 'manager' | 'team' | 'rep'
  owner_id uuid,                -- null for org; user_id or team_id otherwise
  period text not null,         -- 'YYYY-MM'
  revenue_value numeric not null default 0,
  closes_value int not null default 0,
  set_by uuid,
  set_at timestamptz not null default now()
);
create index if not exists targets_lookup_idx on targets(org_id, level, owner_id, period, set_at);
alter table targets drop constraint if exists targets_level_chk;
alter table targets add constraint targets_level_chk check (level in ('org','manager','team','rep'));

alter table targets enable row level security;
drop policy if exists targets_select on targets;
create policy targets_select on targets for select using (is_sa() OR org_id = jwt_org());
drop policy if exists targets_write on targets;
create policy targets_write on targets for all
  using (is_sa() OR (org_id = jwt_org() AND jwt_role() = 'manager'))
  with check (is_sa() OR (org_id = jwt_org() AND jwt_role() = 'manager'));
