-- §14 notifications — real, user-scoped. Bell reads this; a trigger delivers batch-allocation alerts.
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  user_id uuid not null,
  title text not null,
  body text,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications(user_id, created_at desc);
alter table notifications enable row level security;
drop policy if exists notif_select on notifications;
create policy notif_select on notifications for select using (user_id = auth.uid());
drop policy if exists notif_update on notifications;
create policy notif_update on notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- inserts only via the SECURITY DEFINER trigger below

create or replace function notify_batch_allocation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.allocated_manager_id is not null and new.allocated_manager_id is distinct from old.allocated_manager_id then
    insert into notifications(org_id, user_id, title, body, link)
    values (new.org_id, new.allocated_manager_id, 'New batch allocated', 'A batch was allocated to you.', '/leads');
  end if;
  return new;
end $$;
drop trigger if exists trg_notify_batch_allocation on batches;
create trigger trg_notify_batch_allocation after update on batches for each row execute function notify_batch_allocation();
