-- §2 Owner role — per-tenant super-manager (org-wide, above team-scoped managers).
-- Implemented ADDITIVELY: new owner policies only; existing role policies are untouched,
-- so current managers/setters/closers/clients are completely unaffected.
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('superadmin','admin','manager','lead_generator','setter','closer','client','owner'));

do $$
declare t text;
begin
  foreach t in array array['leads','batches','teams','targets','disposition_events','deals','pipeline_config','scripts'] loop
    execute format('drop policy if exists %I on %I', t||'_owner', t);
    execute format($f$create policy %I on %I for all using (jwt_role()='owner' and org_id=jwt_org()) with check (jwt_role()='owner' and org_id=jwt_org())$f$, t||'_owner', t);
  end loop;
  foreach t in array array['audit_log','credit_ledger','org_billing','profiles'] loop
    execute format('drop policy if exists %I on %I', t||'_owner', t);
    execute format($f$create policy %I on %I for select using (jwt_role()='owner' and org_id=jwt_org())$f$, t||'_owner', t);
  end loop;
end $$;

-- team_members has no org_id — scope via its team.
drop policy if exists team_members_owner on team_members;
create policy team_members_owner on team_members for all
  using (jwt_role()='owner' and exists (select 1 from teams tt where tt.id = team_members.team_id and tt.org_id = jwt_org()))
  with check (jwt_role()='owner' and exists (select 1 from teams tt where tt.id = team_members.team_id and tt.org_id = jwt_org()));
