-- Two fixes on batches visibility:
-- 1) Setter (Shahrez) upload failed: app does insert(...).select('id') (RETURNING), but batches_select
--    didn't let a setter read back the batch they just created → RLS error. Add created_by_id
--    (default auth.uid()) and let a creator see their own upload. Pipeline batches (service role)
--    get created_by_id=null, so setters still can't see them (setter-secrecy preserved).
-- 2) Managers must NOT see unallocated batches — they now see ONLY batches allocated to them.
alter table batches add column if not exists created_by_id uuid default auth.uid();
drop policy if exists batches_select on batches;
create policy batches_select on batches for select using (
  is_sa()
  or created_by_id = auth.uid()
  or (has_perm('leads','view') and (
       (jwt_role() = 'lead_generator' and org_id = jwt_org())
    or (jwt_role() = 'manager' and org_id = jwt_org() and allocated_manager_id = auth.uid())
    or is_assigned_batch(id)
  ))
);
