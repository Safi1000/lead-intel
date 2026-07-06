-- ===== Deal object =====
create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  org_id uuid not null,
  closer_id uuid,
  stage text not null default 'new',
  value numeric,
  currency text not null default 'USD',
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists deals_org_idx on deals(org_id);
create index if not exists deals_lead_idx on deals(lead_id);
alter table deals drop constraint if exists deals_stage_chk;
alter table deals add constraint deals_stage_chk check (stage in ('new','contacted','qualified','proposal','won','lost'));

alter table deals enable row level security;
drop policy if exists deals_select on deals;
create policy deals_select on deals for select using (
  is_sa() OR exists (select 1 from leads l where l.id = deals.lead_id)  -- inherits leads RLS
);
drop policy if exists deals_write on deals;
create policy deals_write on deals for all using (
  is_sa() OR (has_perm('leads','edit') AND org_id = jwt_org()
    AND exists (select 1 from leads l where l.id = deals.lead_id and l.org_id = jwt_org()
      and (l.closer_id = auth.uid() or jwt_role() = 'manager')))
) with check (
  is_sa() OR (has_perm('leads','edit') AND org_id = jwt_org()
    AND exists (select 1 from leads l where l.id = deals.lead_id and l.org_id = jwt_org()
      and (l.closer_id = auth.uid() or jwt_role() = 'manager')))
);

-- ===== Floor-control config (editable per org) =====
alter table pipeline_config
  add column if not exists floor_wip_cap int not null default 40,
  add column if not exists floor_sla_hours int not null default 4,
  add column if not exists floor_recycle_attempts int not null default 5;

-- ===== Assignment + first-touch tracking (for WIP / SLA) =====
alter table leads
  add column if not exists assigned_at timestamptz,
  add column if not exists first_touch_at timestamptz;
update leads set assigned_at = coalesce(assigned_at, updated_at) where setter_id is not null and assigned_at is null;

create or replace function track_assignment() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.setter_id is distinct from old.setter_id then
    if new.setter_id is not null then new.assigned_at := now(); new.first_touch_at := null;
    else new.assigned_at := null; new.first_touch_at := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_track_assignment on leads;
create trigger trg_track_assignment before update on leads for each row execute function track_assignment();

-- ===== Extend disposition trigger: first-touch stamp + recycle-after-N =====
create or replace function apply_disposition() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_recycle int; v_new_attempts int;
begin
  select floor_recycle_attempts into v_recycle from pipeline_config
    where org_id = (select org_id from leads where id = new.lead_id) limit 1;
  v_recycle := coalesce(v_recycle, 5);

  update leads set
    attempt_count   = attempt_count + 1,
    first_touch_at  = coalesce(first_touch_at, now()),
    last_touched_at = now(),
    updated_at      = now(),
    dnc             = case when new.tier2 = 'Do not call' then true else dnc end,
    nurture_wake_at = case when new.tier2 in ('Nurture / not now','Callback scheduled') then new.next_action_at else nurture_wake_at end,
    lifecycle_state = case
      when new.tier2 = 'Booked'                then 'Booked'
      when new.tier2 = 'Do not call'           then 'DNC'
      when new.tier2 = 'Nurture / not now'     then 'Nurture'
      when new.tier2 = 'Not interested'        then 'Lost'
      when new.tier2 = 'Not a fit / not DM'    then 'Disqualified'
      when new.tier2 in ('Callback scheduled','Interested – follow up') then 'In Progress'
      -- recycle-after-N: exhausted no-connects auto-park (frees WIP, stays with the rep = sticky)
      when new.tier2 is null and new.tier1 in ('No answer','Voicemail','Busy') and (attempt_count + 1) >= v_recycle then 'Nurture'
      when lifecycle_state = 'Assigned'        then 'In Progress'
      else lifecycle_state
    end
  where id = new.lead_id;
  return new;
end $$;
