-- §10 Sequences / cadences — timed, multi-step follow-up plans. No engine involvement.
create table if not exists cadences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  name text not null,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
create table if not exists cadence_steps (
  id uuid primary key default gen_random_uuid(),
  cadence_id uuid not null references cadences(id) on delete cascade,
  step_order int not null,
  day_offset int not null default 0,          -- days after enrollment this step fires
  action text not null default 'task',        -- 'task' | 'email' | 'move'
  script_id uuid,                             -- optional linked template (scripts)
  note text,
  target_state text                           -- for action='move'
);
create index if not exists cadence_steps_idx on cadence_steps(cadence_id, step_order);
create table if not exists cadence_enrollments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  cadence_id uuid not null references cadences(id) on delete cascade,
  org_id uuid,
  current_step int not null default 0,        -- steps completed so far
  next_run_at timestamptz,
  status text not null default 'active',      -- active | completed | stopped
  enrolled_at timestamptz not null default now()
);
create index if not exists cadence_enroll_due_idx on cadence_enrollments(status, next_run_at);

alter table cadences enable row level security;
alter table cadence_steps enable row level security;
alter table cadence_enrollments enable row level security;
-- read: org members; write: owner/manager
drop policy if exists cadences_rw on cadences;
create policy cadences_rw on cadences for all
  using (is_sa() OR (org_id = jwt_org() AND (jwt_role() in ('owner','manager') OR has_perm('leads','view'))))
  with check (is_sa() OR (org_id = jwt_org() AND jwt_role() in ('owner','manager')));
drop policy if exists cadence_steps_rw on cadence_steps;
create policy cadence_steps_rw on cadence_steps for all
  using (is_sa() OR exists (select 1 from cadences c where c.id = cadence_steps.cadence_id and c.org_id = jwt_org()))
  with check (is_sa() OR exists (select 1 from cadences c where c.id = cadence_steps.cadence_id and c.org_id = jwt_org() and jwt_role() in ('owner','manager')));
drop policy if exists cadence_enroll_rw on cadence_enrollments;
create policy cadence_enroll_rw on cadence_enrollments for all
  using (is_sa() OR (org_id = jwt_org())) with check (is_sa() OR (org_id = jwt_org()));

-- Enroll a lead (manager/owner/setter working the lead).
create or replace function enroll_in_cadence(p_lead uuid, p_cadence uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_off int; v_org uuid;
begin
  select org_id into v_org from leads where id = p_lead;
  if not (is_sa() or (v_org = jwt_org() and has_perm('leads','edit'))) then raise exception 'Not allowed'; end if;
  select day_offset into v_off from cadence_steps where cadence_id = p_cadence order by step_order limit 1;
  if v_off is null then raise exception 'Cadence has no steps'; end if;
  insert into cadence_enrollments(lead_id, cadence_id, org_id, current_step, next_run_at, status)
  values (p_lead, p_cadence, v_org, 0, now() + make_interval(days => v_off), 'active');
end $$;

-- Executor: fire due steps, advance enrollments. Scheduled hourly.
create or replace function run_cadences() returns int
language plpgsql security definer set search_path = public as $$
declare e record; s record; nxt record; n int := 0;
begin
  for e in select * from cadence_enrollments where status = 'active' and next_run_at is not null and next_run_at <= now() loop
    select * into s from cadence_steps where cadence_id = e.cadence_id order by step_order offset e.current_step limit 1;
    if not found then
      update cadence_enrollments set status = 'completed', next_run_at = null where id = e.id; continue;
    end if;
    if s.action = 'move' and s.target_state is not null then
      update leads set lifecycle_state = s.target_state, updated_at = now() where id = e.lead_id;
    else
      -- task/email: surface in the rep's queue as a due follow-up (no automation wording)
      update leads set next_follow_up = current_date, updated_at = now() where id = e.lead_id;
    end if;
    select * into nxt from cadence_steps where cadence_id = e.cadence_id order by step_order offset (e.current_step + 1) limit 1;
    if found then
      update cadence_enrollments set current_step = e.current_step + 1, next_run_at = e.enrolled_at + make_interval(days => nxt.day_offset) where id = e.id;
    else
      update cadence_enrollments set current_step = e.current_step + 1, status = 'completed', next_run_at = null where id = e.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

select cron.unschedule(jobid) from cron.job where jobname = 'run-cadences';
select cron.schedule('run-cadences', '0 * * * *', 'select run_cadences()');
