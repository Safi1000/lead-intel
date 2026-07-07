-- §2 matrix: "set manager targets" = Owner only; managers may only split to reps.
drop policy if exists targets_write on targets;
create policy targets_write on targets for all
  using (is_sa() OR (org_id = jwt_org() AND (jwt_role() = 'owner' OR (jwt_role() = 'manager' AND level = 'rep'))))
  with check (is_sa() OR (org_id = jwt_org() AND (jwt_role() = 'owner' OR (jwt_role() = 'manager' AND level = 'rep'))));
