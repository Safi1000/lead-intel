-- Batches page "worked" now means "marked Done": add done_count to batch_stats.
-- security_invoker=on preserved (the original RLS-leak fix).
create or replace view batch_stats with (security_invoker = on) as
select b.id, b.org_id, b.template_id, b.template_name, b.file_name, b.total_rows,
  b.imported_count, b.rejected_count, b.created_by, b.created_at,
  count(l.id) as lead_count,
  count(l.id) filter (where l.setter_id is not null) as assigned_count,
  count(l.id) filter (where l.setter_id is null) as unassigned_count,
  count(l.id) filter (where l.stage = 'New') as new_count,
  count(l.id) filter (where l.stage = 'Contacted') as contacted_count,
  count(l.id) filter (where l.stage = 'Interested') as interested_count,
  count(l.id) filter (where l.stage = 'Booked') as booked_count,
  count(l.id) filter (where l.stage = 'Not Now') as notnow_count,
  count(l.id) filter (where l.stage = 'Won') as won_count,
  count(l.id) filter (where l.stage = 'Lost') as lost_count,
  b.archived_at, b.allocated_manager_id,
  count(l.id) filter (where l.done_at is not null) as done_count
from batches b left join leads l on l.batch_id = b.id group by b.id;
