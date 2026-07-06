-- SLA tracking starts fresh from (re)assignment — clear backfilled assigned_at so the cron never
-- retroactively recycles the entire existing book (none of which has a first_touch_at yet).
update leads set assigned_at = null where assigned_at is not null;

-- Recycle first-touch SLA breaches to the open pool (per §6: SLA breach -> pool, not sticky).
create or replace function recycle_sla_breaches() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with breached as (
    select l.id from leads l
    join pipeline_config pc on pc.org_id = l.org_id
    where l.setter_id is not null and l.first_touch_at is null and l.assigned_at is not null
      and l.done_at is null and l.lifecycle_state in ('Assigned','In Progress')
      and l.assigned_at + make_interval(hours => pc.floor_sla_hours) < now()
  )
  update leads set setter_id = null, lifecycle_state = 'Unassigned'
  from breached where leads.id = breached.id;
  get diagnostics n = row_count;
  return n;
end $$;

select cron.unschedule(jobid) from cron.job where jobname = 'sla-recycle';
select cron.schedule('sla-recycle', '*/5 * * * *', 'select recycle_sla_breaches()');
