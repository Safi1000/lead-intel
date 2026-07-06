-- ===== Team layer + multi-tenant scoping =====

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  manager_id uuid,
  name text not null,
  created_at timestamptz not null default now()
);
create index if not exists teams_org_idx on teams(org_id);

create table if not exists team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null,
  role_in_team text not null default 'setter',
  primary key (team_id, user_id)
);
alter table team_members drop constraint if exists tm_role_chk;
alter table team_members add constraint tm_role_chk check (role_in_team in ('setter','closer','manager'));
create index if not exists tm_user_idx on team_members(user_id);

alter table leads add column if not exists team_id uuid references teams(id) on delete set null;
create index if not exists leads_team_idx on leads(team_id);

-- teams the current user can access (manages OR is a member of)
create or replace function my_team_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from teams where manager_id = auth.uid()
  union
  select team_id from team_members where user_id = auth.uid();
$$;

-- default team per existing org + memberships + lead assignment (idempotent)
do $$
declare o record; t uuid; mgr uuid;
begin
  for o in select id from orgs loop
    if not exists (select 1 from teams where org_id = o.id) then
      select id into mgr from profiles where org_id = o.id and role = 'manager' limit 1;
      insert into teams (org_id, manager_id, name) values (o.id, mgr, 'Default Team') returning id into t;
      insert into team_members (team_id, user_id, role_in_team)
        select t, p.id, p.role from profiles p
        where p.org_id = o.id and p.role in ('setter','closer','manager')
        on conflict do nothing;
      update leads set team_id = t where org_id = o.id and team_id is null;
    end if;
  end loop;
end $$;

update disposition_events d set team_id = l.team_id from leads l where l.id = d.lead_id and d.team_id is null;

-- auto default team for NEW orgs
create or replace function ensure_default_team() returns trigger
language plpgsql security definer set search_path = public as $$
begin insert into teams (org_id, name) values (new.id, 'Default Team'); return new; end $$;
drop trigger if exists trg_org_default_team on orgs;
create trigger trg_org_default_team after insert on orgs for each row execute function ensure_default_team();

-- disposition_events inherit team/manager from their lead
create or replace function set_dispo_team() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.team_id is null then
    select l.team_id, t.manager_id into new.team_id, new.manager_id
    from leads l left join teams t on t.id = l.team_id where l.id = new.lead_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_set_dispo_team on disposition_events;
create trigger trg_set_dispo_team before insert on disposition_events for each row execute function set_dispo_team();

-- RLS: teams + team_members (org-scoped)
alter table teams enable row level security;
drop policy if exists teams_select on teams;
create policy teams_select on teams for select using (is_sa() OR org_id = jwt_org());
drop policy if exists teams_write on teams;
create policy teams_write on teams for all
  using (is_sa() OR (org_id = jwt_org() AND jwt_role() = 'manager'))
  with check (is_sa() OR (org_id = jwt_org() AND jwt_role() = 'manager'));

alter table team_members enable row level security;
drop policy if exists tm_select on team_members;
create policy tm_select on team_members for select using (
  is_sa() OR exists (select 1 from teams t where t.id = team_members.team_id and t.org_id = jwt_org())
);
drop policy if exists tm_write on team_members;
create policy tm_write on team_members for all using (
  is_sa() OR exists (select 1 from teams t where t.id = team_members.team_id and t.org_id = jwt_org() and jwt_role() = 'manager')
) with check (
  is_sa() OR exists (select 1 from teams t where t.id = team_members.team_id and t.org_id = jwt_org() and jwt_role() = 'manager')
);

-- Tighten leads: managers scoped to their teams (+ untriaged null-team pool in org). Non-breaking:
-- migration put all leads in the default team and all managers in it as members.
drop policy if exists leads_select on leads;
create policy leads_select on leads for select using (
  is_sa() OR (has_perm('leads','view') AND (
    (jwt_role() = 'lead_generator' AND org_id = jwt_org())
    OR (jwt_role() = 'manager' AND org_id = jwt_org() AND (team_id is null OR team_id in (select my_team_ids())))
    OR setter_id = auth.uid() OR closer_id = auth.uid()
  ))
);
drop policy if exists leads_update on leads;
create policy leads_update on leads for update using (
  is_sa() OR (has_perm('leads','edit') AND (
    (jwt_role() = 'manager' AND org_id = jwt_org() AND (team_id is null OR team_id in (select my_team_ids())))
    OR setter_id = auth.uid() OR closer_id = auth.uid()
  ))
) with check (
  is_sa() OR (has_perm('leads','edit') AND (
    (jwt_role() = 'manager' AND org_id = jwt_org() AND (team_id is null OR team_id in (select my_team_ids())))
    OR setter_id = auth.uid() OR closer_id = auth.uid()
  ))
);
drop policy if exists leads_delete on leads;
create policy leads_delete on leads for delete using (
  is_sa() OR (org_id = jwt_org() AND jwt_role() = 'manager' AND (team_id is null OR team_id in (select my_team_ids())))
);
