-- WIP cap bug: assign_leads_to_setter set setter_id but NOT lifecycle_state, and did no server-side
-- WIP check. So after leads were assigned they stayed 'Unassigned' lifecycle -> setterLoads (which
-- counts Assigned/In Progress, not done) saw 0 -> the cap never fired (e.g. Amish 256 assigned, cap 200).
-- Fix: assignment now sets lifecycle_state='Assigned' AND enforces the org WIP cap in the RPC.
create or replace function public.assign_leads_to_setter(p_batch uuid, p_setter uuid, p_count integer)
returns integer language plpgsql security definer set search_path to '' as $function$
declare v_org uuid; v_name text; n int; v_cap int; v_load int; v_room int; v_take int;
begin
  select org_id into v_org from public.batches where id = p_batch;
  if v_org is null then raise exception 'Batch not found'; end if;
  if not (public.is_sa() or (public.jwt_org() = v_org and public.jwt_role() in ('manager','owner'))) then
    raise exception 'Not allowed';
  end if;
  select name into v_name from public.profiles where id = p_setter and org_id = v_org and role = 'setter';
  if v_name is null then raise exception 'Setter not found in this organization'; end if;
  select coalesce(floor_wip_cap, 40) into v_cap from public.pipeline_config where org_id = v_org;
  v_cap := coalesce(v_cap, 40);
  select count(*) into v_load from public.leads
    where setter_id = p_setter and done_at is null and lifecycle_state in ('Assigned','In Progress');
  v_room := greatest(0, v_cap - v_load);
  v_take := least(greatest(p_count, 0), v_room);
  if v_take = 0 then return 0; end if;
  with picked as (
    select id from public.leads
    where batch_id = p_batch and setter_id is null and done_at is null
    order by random() limit v_take for update skip locked
  )
  update public.leads l
    set setter_id = p_setter, setter = v_name, lifecycle_state = 'Assigned',
        status = case when l.status = 'new' then 'with_setter' else l.status end, updated_at = now()
    from picked where l.id = picked.id;
  get diagnostics n = row_count;
  insert into public.batch_assignments (batch_id, user_id, org_id, role)
    values (p_batch, p_setter, v_org, 'setter') on conflict (batch_id, user_id) do nothing;
  return n;
end $function$;

-- One-time data fix: leads assigned before the fix (setter_id set, not done) but mislabeled 'Unassigned'.
update public.leads set lifecycle_state='Assigned'
  where setter_id is not null and done_at is null and lifecycle_state='Unassigned';
