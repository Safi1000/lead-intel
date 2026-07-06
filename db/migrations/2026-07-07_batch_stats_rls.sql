-- batch_stats is queried by the Leads/Batches page but ran as the view owner, bypassing RLS on
-- leads/batches — so setters saw every batch and org-wide totals. security_invoker makes the view
-- apply the *caller's* RLS, so a setter sees only their batches and their own lead counts.
alter view public.batch_stats set (security_invoker = on);
