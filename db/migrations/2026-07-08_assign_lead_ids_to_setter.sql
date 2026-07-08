-- Assign SPECIFIC selected leads to a setter (for the "select unassigned leads -> assign" flow),
-- WIP-capped and setting lifecycle_state='Assigned'. Manager/owner/SA only, own org.
create or replace function public.assign_lead_ids_to_setter(p_lead_ids uuid[], p_setter uuid)
returns integer language plpgsql security definer set search_path to '' as $function$
declare v_org uuid; v_name text; n int; v_cap int; v_load int; v_room int;
begin
  select org_id, name into v_org, v_name from public.profiles where id = p_setter and role = 'setter';
  if v_name is null then raise exception 'Setter not found'; end if;
  if not (public.is_sa() or (public.jwt_org() = v_org and public.jwt_role() in ('manager','owner'))) then
    raise exception 'Not allowed';
  end if;
  select coalesce(floor_wip_cap, 40) into v_cap from public.pipeline_config where org_id = v_org;
  v_cap := coalesce(v_cap, 40);
  select count(*) into v_load from public.leads where setter_id = p_setter and done_at is null and lifecycle_state in ('Assigned','In Progress');
  v_room := greatest(0, v_cap - v_load);
  if v_room = 0 then return 0; end if;
  with picked as (
    select id from public.leads
    where id = any(p_lead_ids) and org_id = v_org and setter_id is null and done_at is null
    order by random() limit v_room for update skip locked
  )
  update public.leads l
    set setter_id = p_setter, setter = v_name, lifecycle_state = 'Assigned',
        status = case when l.status = 'new' then 'with_setter' else l.status end, updated_at = now()
    from picked where l.id = picked.id;
  get diagnostics n = row_count;
  return n;
end $function$;
