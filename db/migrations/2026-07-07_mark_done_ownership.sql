-- Audit fix: mark_lead_done guarded org but not ownership — a setter could toggle any org lead.
-- Restrict setters/closers to their own leads; managers/lead_generators keep org-wide.
create or replace function mark_lead_done(p_lead uuid, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('leads','edit') then raise exception 'Not authorized to edit leads'; end if;
  update leads
     set done_at = case when p_done then now() else null end,
         done_by = case when p_done then auth.uid() else null end,
         updated_at = now()
   where id = p_lead
     and (is_sa() or org_id = jwt_org())
     and (is_sa() or jwt_role() in ('manager','lead_generator') or setter_id = auth.uid() or closer_id = auth.uid());
end $$;
