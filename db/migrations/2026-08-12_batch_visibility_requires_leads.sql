-- A batch is only visible to a setter/closer if they actually hold a lead in it.
--
-- Before: batch_assignments alone granted visibility, so a setter kept seeing a
-- batch on the Leads page after every one of their leads was reassigned or
-- released — an empty batch they could open but not work. batch_assignments is
-- no longer written by any UI path; the leads themselves are the source of truth.
--
-- Managers (allocated_manager_id), lead generators, batch creators and
-- superadmins are unaffected — they match earlier branches of batches_select.

create or replace function public.is_assigned_batch(p_batch uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.leads l
    where l.batch_id = p_batch
      and (l.setter_id = auth.uid() or l.closer_id = auth.uid())
  );
$$;
