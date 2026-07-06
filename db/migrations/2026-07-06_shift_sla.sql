-- Shift-aware SLA: only hours inside the PKT calling shift (19:00–02:00 PKT = 14:00–21:00 UTC) count.
create or replace function shift_seconds(a timestamptz, b timestamptz) returns double precision
language plpgsql immutable set search_path = public as $$
declare total double precision := 0; d date; ws timestamptz; we timestamptz;
begin
  if a is null or b is null or b <= a then return 0; end if;
  d := (a at time zone 'UTC')::date;
  while d <= (b at time zone 'UTC')::date loop
    ws := (d + time '14:00') at time zone 'UTC';
    we := (d + time '21:00') at time zone 'UTC';
    total := total + greatest(0, extract(epoch from (least(b, we) - greatest(a, ws))));
    d := d + 1;
  end loop;
  return total;
end $$;

create or replace function recycle_sla_breaches() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with breached as (
    select l.id from leads l
    join pipeline_config pc on pc.org_id = l.org_id
    where l.setter_id is not null and l.first_touch_at is null and l.assigned_at is not null
      and l.done_at is null and l.lifecycle_state in ('Assigned','In Progress')
      and shift_seconds(l.assigned_at, now()) > pc.floor_sla_hours * 3600
  )
  update leads set setter_id = null, lifecycle_state = 'Unassigned'
  from breached where leads.id = breached.id;
  get diagnostics n = row_count;
  return n;
end $$;
