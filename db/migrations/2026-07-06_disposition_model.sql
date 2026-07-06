-- ===== Disposition model =====

-- 1) Lead columns driving the disposition lifecycle
alter table leads
  add column if not exists lifecycle_state text,
  add column if not exists dnc boolean not null default false,
  add column if not exists attempt_count int not null default 0,
  add column if not exists last_touched_at timestamptz,
  add column if not exists nurture_wake_at timestamptz;

update leads set lifecycle_state = case
  when stage = 'Booked' then 'Booked'
  when stage = 'Won' then 'Won'
  when stage = 'Lost' then 'Lost'
  when stage = 'Not Now' then 'Nurture'
  when stage in ('Contacted','Interested') then 'In Progress'
  when stage = 'New' and setter_id is not null then 'Assigned'
  when stage = 'New' then 'Unassigned'
  else 'Assigned'
end
where lifecycle_state is null;

-- 2) Append-only disposition_events
create table if not exists disposition_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  org_id uuid not null,
  rep_id uuid not null default auth.uid(),
  team_id uuid,
  manager_id uuid,
  tier1 text not null,
  tier2 text,
  notes text,
  next_action_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists dispo_lead_idx on disposition_events(lead_id, created_at desc);
create index if not exists dispo_org_idx  on disposition_events(org_id, created_at desc);

alter table disposition_events drop constraint if exists dispo_tier1_chk;
alter table disposition_events add constraint dispo_tier1_chk check (tier1 in
  ('No answer','Voicemail','Busy','Bad/Wrong number','Gatekeeper block','Connected'));
alter table disposition_events drop constraint if exists dispo_tier2_chk;
alter table disposition_events add constraint dispo_tier2_chk check (tier2 is null or tier2 in
  ('Booked','Interested – follow up','Callback scheduled','Nurture / not now','Not interested','Do not call','Not a fit / not DM'));

-- 3) RLS — mirrors leads' JWT-claim pattern
alter table disposition_events enable row level security;

drop policy if exists dispo_select on disposition_events;
create policy dispo_select on disposition_events for select using (
  is_sa() OR (has_perm('leads','view') AND (
    ((jwt_role() = any(array['manager','lead_generator'])) AND org_id = jwt_org())
    OR exists (select 1 from leads l where l.id = disposition_events.lead_id and (l.setter_id = auth.uid() or l.closer_id = auth.uid()))
  ))
);

drop policy if exists dispo_insert on disposition_events;
create policy dispo_insert on disposition_events for insert with check (
  is_sa() OR (has_perm('leads','edit') AND org_id = jwt_org() AND (
    jwt_role() = 'manager'
    OR (rep_id = auth.uid() AND exists (select 1 from leads l where l.id = lead_id and (l.setter_id = auth.uid() or l.closer_id = auth.uid())))
  ))
);
-- no update/delete policies => append-only for app users (service_role bypasses)

-- 4) Trigger: disposition -> lifecycle, attempts, dnc, wake
create or replace function apply_disposition() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update leads set
    attempt_count   = attempt_count + 1,
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
      when lifecycle_state = 'Assigned'        then 'In Progress'
      else lifecycle_state
    end
  where id = new.lead_id;
  return new;
end; $$;

drop trigger if exists trg_apply_disposition on disposition_events;
create trigger trg_apply_disposition after insert on disposition_events
  for each row execute function apply_disposition();
