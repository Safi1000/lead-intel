-- ============================================================================
-- Deleting a user must release their book back to the pool.
--
-- Before this, the `admin` edge function's delete_user action only called
-- auth.admin.deleteUser(). There is no FK or trigger from auth.users ->
-- public.profiles, so the profile row and every lead assignment survived the
-- delete: the user vanished from login but kept holding leads as a ghost.
--
-- Release policy (deliberate, matches the app's existing rules):
--   * OPEN leads (done_at is null)  -> fully back to the pool: setter_id, setter
--     text and assigned_at cleared, lifecycle_state 'Unassigned', status 'new'.
--     This mirrors the reassign-to-nobody path in src/api/endpoints.ts.
--   * DONE leads (done_at not null) -> setter_id cleared, but the `setter` TEXT
--     is kept as a historical label so reporting still shows who worked it.
--     Safe from re-outreach: assign_leads_to_setter() and
--     assign_lead_ids_to_setter() both filter `and done_at is null`, so a done
--     lead can never be handed to another setter.
--
-- The `setter` text column is cleared alongside setter_id on the open-lead path
-- because clearing only the id is what stranded ~50 rows with a live name and a
-- null id (see the companion fix in src/api/endpoints.ts).
-- ============================================================================

-- protect_done_lead_assignment() silently reverts setter_id on any done lead.
-- That pin also defeats leads_setter_id_fkey's ON DELETE SET NULL, so deleting
-- a user who had ANY finished lead failed outright with a foreign key violation
-- on `delete from profiles` — the delete was impossible, not merely incomplete.
--
-- Offboarding is the one legitimate reason to break the pin. The RPC below sets
-- app.offboarding for the duration of its transaction; in that mode setter_id
-- may be released while the `setter` NAME is still preserved, so reporting keeps
-- the attribution. Every other write path behaves exactly as before.
create or replace function protect_done_lead_assignment()
returns trigger
language plpgsql
as $function$
BEGIN
  IF OLD.done_at IS NOT NULL THEN
    IF coalesce(current_setting('app.offboarding', true), '') = 'on' THEN
      NEW.setter := OLD.setter;
    ELSE
      NEW.setter_id := OLD.setter_id;
      NEW.setter    := OLD.setter;
      IF NEW.status = 'new' AND OLD.status <> 'new' THEN NEW.status := OLD.status; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $function$;
create or replace function delete_user_and_release_leads(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target   profiles%rowtype;
  v_actor    uuid := auth.uid();
  v_service  boolean := current_user = 'service_role';
  n_released int := 0;
  n_kept     int := 0;
begin
  select * into v_target from profiles where id = p_user_id;
  if v_target.id is null then
    raise exception 'User not found';
  end if;

  -- Same authority model as the admin edge function: service role (which has
  -- already authorized its caller), a super admin, or a manager/owner in the
  -- target's own org. Super admins can never be deleted through this path.
  if not (v_service or is_sa() or (jwt_org() = v_target.org_id and jwt_role() in ('manager', 'owner'))) then
    raise exception 'Not allowed';
  end if;
  if v_target.role in ('superadmin', 'admin') then
    raise exception 'Cannot delete a super admin';
  end if;

  -- Transaction-local: lets this one path release done leads. Resets on commit.
  perform set_config('app.offboarding', 'on', true);

  update leads
     set setter_id = null, setter = null, assigned_at = null,
         lifecycle_state = 'Unassigned', status = 'new', updated_at = now()
   where setter_id = p_user_id and done_at is null;
  get diagnostics n_released = row_count;

  -- setter text survives via the trigger's offboarding branch above.
  update leads
     set setter_id = null, updated_at = now()
   where setter_id = p_user_id and done_at is not null;
  get diagnostics n_kept = row_count;

  -- Closer side has no done-lead exemption; release it outright.
  update leads set closer_id = null, closer = null, updated_at = now()
   where closer_id = p_user_id;

  delete from batch_assignments where user_id = p_user_id;
  delete from team_members     where user_id = p_user_id;

  insert into audit_log (org_id, actor_id, action, target, meta)
  values (v_target.org_id, v_actor, 'user.deleted', p_user_id,
          jsonb_build_object('name', v_target.name, 'email', v_target.email, 'role', v_target.role,
                             'leads_released', n_released, 'leads_kept_attributed', n_kept));

  -- Drops the profile. leads.done_by is ON DELETE SET NULL, so completion
  -- attribution falls back to the `setter` text preserved above.
  delete from profiles where id = p_user_id;

  return jsonb_build_object('released', n_released, 'kept_attributed', n_kept);
end $$;

comment on function delete_user_and_release_leads(uuid) is
  'Deletes a profile and releases its book: open leads return to the pool, done leads keep the setter name for attribution but drop setter_id.';

revoke all on function delete_user_and_release_leads(uuid) from public, anon;
grant execute on function delete_user_and_release_leads(uuid) to service_role, authenticated;
