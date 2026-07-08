-- Cadences now drive the user-facing stage (New/Contacted/Interested/Booked/Voicemail/Follow-up),
-- not the derived lifecycle_state. Repoint the 'move' action + normalise any legacy targets so the
-- executor can't violate leads_stage_check.
update cadence_steps set target_state = 'Follow-up'
  where action = 'move' and target_state is not null
    and target_state not in ('New','Contacted','Interested','Booked','Voicemail','Follow-up');

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
      update leads set stage = s.target_state, updated_at = now() where id = e.lead_id;
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
