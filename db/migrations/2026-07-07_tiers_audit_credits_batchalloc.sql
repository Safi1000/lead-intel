-- ===== §7 last-disposition on the lead (for tier-1/tier-2 filter chips) =====
alter table leads add column if not exists last_tier1 text;
alter table leads add column if not exists last_tier2 text;

create or replace function apply_disposition() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_recycle int;
begin
  select floor_recycle_attempts into v_recycle from pipeline_config
    where org_id = (select org_id from leads where id = new.lead_id) limit 1;
  v_recycle := coalesce(v_recycle, 5);
  update leads set
    attempt_count   = attempt_count + 1,
    first_touch_at  = coalesce(first_touch_at, now()),
    last_touched_at = now(),
    updated_at      = now(),
    last_tier1      = new.tier1,
    last_tier2      = new.tier2,
    dnc             = case when new.tier2 = 'Do not call' then true else dnc end,
    nurture_wake_at = case when new.tier2 in ('Nurture / not now','Callback scheduled') then new.next_action_at else nurture_wake_at end,
    lifecycle_state = case
      when new.tier2 = 'Booked'                then 'Booked'
      when new.tier2 = 'Do not call'           then 'DNC'
      when new.tier2 = 'Nurture / not now'     then 'Nurture'
      when new.tier2 = 'Not interested'        then 'Lost'
      when new.tier2 = 'Not a fit / not DM'    then 'Disqualified'
      when new.tier2 in ('Callback scheduled','Interested – follow up') then 'In Progress'
      when new.tier2 is null and new.tier1 in ('No answer','Voicemail','Busy') and (attempt_count + 1) >= v_recycle then 'Nurture'
      when lifecycle_state = 'Assigned'        then 'In Progress'
      else lifecycle_state
    end
  where id = new.lead_id;
  return new;
end $$;

-- ===== §3 AuditLog — immutable who-did-what, auto-populated by triggers =====
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  actor_id uuid,
  action text not null,
  target uuid,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_org_idx on audit_log(org_id, created_at desc);
alter table audit_log enable row level security;
drop policy if exists audit_select on audit_log;
create policy audit_select on audit_log for select
  using (is_sa() OR (org_id = jwt_org() AND jwt_role() = 'manager'));
-- no insert/update/delete policies: rows arrive only via SECURITY DEFINER triggers; immutable.

create or replace function audit_disposition() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log(org_id, actor_id, action, target, meta)
  values (new.org_id, auth.uid(), 'disposition', new.lead_id, jsonb_build_object('tier1', new.tier1, 'tier2', new.tier2));
  return new;
end $$;
drop trigger if exists trg_audit_disposition on disposition_events;
create trigger trg_audit_disposition after insert on disposition_events for each row execute function audit_disposition();

create or replace function audit_deal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log(org_id, actor_id, action, target, meta)
  values (new.org_id, auth.uid(), 'deal', new.lead_id, jsonb_build_object('stage', new.stage, 'value', new.value));
  return new;
end $$;
drop trigger if exists trg_audit_deal on deals;
create trigger trg_audit_deal after insert on deals for each row execute function audit_deal();

create or replace function audit_reassign() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.setter_id is distinct from old.setter_id then
    insert into audit_log(org_id, actor_id, action, target, meta)
    values (new.org_id, auth.uid(), 'reassign', new.id, jsonb_build_object('setter_id', new.setter_id));
  end if;
  return new;
end $$;
drop trigger if exists trg_audit_reassign on leads;
create trigger trg_audit_reassign after update on leads for each row execute function audit_reassign();

-- ===== §3/§13 CreditLedger — schema for provider spend (populated once engine hooks land) =====
create table if not exists credit_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  provider text,
  amount numeric not null default 0,
  type text not null default 'debit',
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_org_idx on credit_ledger(org_id, created_at desc);
alter table credit_ledger enable row level security;
drop policy if exists credit_ledger_select on credit_ledger;
create policy credit_ledger_select on credit_ledger for select
  using (is_sa() OR (org_id = jwt_org() AND jwt_role() = 'manager'));

-- ===== §5 batch->manager allocation =====
alter table batches add column if not exists allocated_manager_id uuid;
