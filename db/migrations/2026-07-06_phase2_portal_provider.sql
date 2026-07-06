-- ===== Billing / credits (§13) — per-tenant commercial config =====
create table if not exists org_billing (
  org_id uuid primary key references orgs(id) on delete cascade,
  plan text not null default 'per_lead',        -- 'per_lead' | 'monthly' | 'hybrid'
  price_per_lead numeric not null default 0,
  monthly_fee numeric not null default 0,
  credits_remaining numeric not null default 0,
  notes text,
  updated_at timestamptz not null default now()
);
alter table org_billing enable row level security;
drop policy if exists org_billing_sa on org_billing;
create policy org_billing_sa on org_billing for all using (is_sa()) with check (is_sa());
drop policy if exists org_billing_read on org_billing;
create policy org_billing_read on org_billing for select using (is_sa() OR org_id = jwt_org());

-- ===== Provider console aggregate (Surface 3) — superadmin only =====
create or replace function provider_overview()
returns table(org_id uuid, org_name text, leads_total bigint, delivered_30d bigint, booked bigint,
              plan text, price_per_lead numeric, monthly_fee numeric, credits_remaining numeric)
language plpgsql security definer set search_path = public as $$
begin
  if not is_sa() then raise exception 'forbidden'; end if;
  return query
    select o.id, o.name,
      count(l.*)::bigint,
      count(l.*) filter (where l.created_at > now() - interval '30 days')::bigint,
      count(l.*) filter (where l.lifecycle_state = 'Booked')::bigint,
      coalesce(b.plan, 'per_lead'), coalesce(b.price_per_lead, 0), coalesce(b.monthly_fee, 0), coalesce(b.credits_remaining, 0)
    from orgs o
    left join leads l on l.org_id = o.id
    left join org_billing b on b.org_id = o.id
    group by o.id, o.name, b.plan, b.price_per_lead, b.monthly_fee, b.credits_remaining
    order by count(l.*) desc;
end $$;

-- ===== Client portal (Surface 2) — read-only role. Additive SELECT policies (OR'd with existing). =====
drop policy if exists leads_client_read on leads;
create policy leads_client_read on leads for select using (jwt_role() = 'client' AND org_id = jwt_org());
drop policy if exists orgs_client_read on orgs;
create policy orgs_client_read on orgs for select using (jwt_role() = 'client' AND id = jwt_org());

-- Allow the new 'client' role (and 'admin', which the Role type has but the constraint lacked).
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('superadmin','admin','manager','lead_generator','setter','closer','client'));
