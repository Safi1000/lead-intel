-- Fix: owner could not upload leads/CSV (RLS rejection). has_perm()'s role matrix granted
-- upload:create only to manager/lead_generator; owner relied solely on the _owner RLS policies
-- (jwt_role()='owner'), which fail on a stale token. Give owner full access in has_perm (like
-- superadmin/admin), reading profiles.role from the DB — independent of the JWT claim.
create or replace function public.has_perm(p_resource text, p_action text)
returns boolean language plpgsql stable security definer set search_path to '' as $function$
declare v_role text; v_perms jsonb; v_key text := p_resource || ':' || p_action; v_default boolean;
begin
  select role, permissions into v_role, v_perms from public.profiles where id = auth.uid();
  if v_role is null then return false; end if;
  if v_role in ('superadmin','admin','owner') then return true; end if;
  if (v_perms -> 'denied') ? v_key then return false; end if;
  if (v_perms -> 'granted') ? v_key then return true; end if;
  v_default := case v_key
    when 'templates:view' then v_role in ('manager','lead_generator')
    when 'templates:create' then v_role in ('manager','lead_generator')
    when 'templates:edit' then v_role in ('manager','lead_generator')
    when 'templates:delete' then v_role = 'manager'
    when 'upload:view' then v_role in ('manager','lead_generator')
    when 'upload:create' then v_role in ('manager','lead_generator')
    when 'leads:view' then v_role in ('manager','lead_generator','setter','closer')
    when 'leads:edit' then v_role in ('manager','setter','closer')
    when 'users:view' then v_role = 'manager'
    when 'users:manage' then v_role = 'manager'
    when 'account:view' then v_role in ('manager','lead_generator','setter','closer')
    when 'account:manage' then v_role = 'manager'
    else false end;
  return coalesce(v_default, false);
end $function$;
