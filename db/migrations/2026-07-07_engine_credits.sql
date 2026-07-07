-- §13 engine cost/credits. Metering is OPT-IN per tenant (metered=false default) so every current
-- org (all at 0 credits) keeps running unlimited — zero behaviour change until an SA turns it on.
alter table org_billing add column if not exists metered boolean not null default false;
alter table batches add column if not exists credit_cost numeric not null default 0;
alter table batches add column if not exists credit_exhausted boolean not null default false;
alter table batches add column if not exists source_params jsonb;
alter table batches add column if not exists field_mask jsonb;

-- Meter each engine-sourced lead: decrement the org's balance + tally the batch cost.
create or replace function meter_lead_credit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_metered boolean; v_rate numeric := 0.02; v_engine boolean;
begin
  if new.batch_id is null then return new; end if;
  select metered into v_metered from org_billing where org_id = new.org_id;
  if not coalesce(v_metered, false) then return new; end if;          -- fast path: un-metered (all orgs today)
  select (b.created_by = 'pipeline') into v_engine from batches b where b.id = new.batch_id;
  if not coalesce(v_engine, false) then return new; end if;           -- only engine-sourced leads cost credits
  update org_billing set credits_remaining = greatest(0, coalesce(credits_remaining,0) - v_rate), updated_at = now() where org_id = new.org_id;
  update batches set credit_cost = coalesce(credit_cost,0) + v_rate where id = new.batch_id;
  return new;
end $$;
drop trigger if exists trg_meter_lead_credit on leads;
create trigger trg_meter_lead_credit after insert on leads for each row execute function meter_lead_credit();

-- provider_overview gains the metered flag (SA sees + toggles it in the billing dialog).
drop function if exists provider_overview();
create function provider_overview()
returns table(org_id uuid, org_name text, leads_total bigint, delivered_30d bigint, booked bigint,
              plan text, price_per_lead numeric, monthly_fee numeric, credits_remaining numeric, metered boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not is_sa() then raise exception 'forbidden'; end if;
  return query
    select o.id, o.name, count(l.*)::bigint,
      count(l.*) filter (where l.created_at > now() - interval '30 days')::bigint,
      count(l.*) filter (where l.lifecycle_state = 'Booked')::bigint,
      coalesce(b.plan,'per_lead'), coalesce(b.price_per_lead,0), coalesce(b.monthly_fee,0),
      coalesce(b.credits_remaining,0), coalesce(b.metered,false)
    from orgs o left join leads l on l.org_id = o.id left join org_billing b on b.org_id = o.id
    group by o.id, o.name, b.plan, b.price_per_lead, b.monthly_fee, b.credits_remaining, b.metered
    order by count(l.*) desc;
end $$;
