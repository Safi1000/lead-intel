-- ============================================================================
-- Cached-price debit. A lead that came from the shared cache bills at the
-- discounted price (cached_discount, default 10%): fresh = price_per_lead ($0.25),
-- cached = price_per_lead * (1 - cached_discount) ($0.225) — i.e. 1 credit vs 0.9.
--
-- The engine now stamps leads.source_meta.from_cache (true on a place_cache hit);
-- this trigger reads it. Un-metered orgs (all today) are unaffected.
--
-- NOT APPLIED — pending Safi's "go" (prod DB). Ships together with the pipeline-run
-- redeploy that writes source_meta.from_cache.
-- ============================================================================
create or replace function meter_lead_credit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_metered boolean;
  v_price   numeric;
  v_disc    numeric;
  v_engine  boolean;
  v_cached  boolean;
  v_rate    numeric;   -- what the customer is billed (wallet debit)
  v_cost    numeric;   -- our COGS tally on the batch (for margin)
begin
  if new.batch_id is null then return new; end if;

  select metered, coalesce(price_per_lead, 0.25), coalesce(cached_discount, 0.10)
    into v_metered, v_price, v_disc
    from org_billing where org_id = new.org_id;
  if not coalesce(v_metered, false) then return new; end if;             -- un-metered: unlimited/free

  select (b.created_by = 'pipeline') into v_engine from batches b where b.id = new.batch_id;
  if not coalesce(v_engine, false) then return new; end if;              -- only engine leads bill

  v_cached := coalesce((new.source_meta->>'from_cache')::boolean, false);

  -- Customer price: cache hits get the discount (already enriched → cheaper for us).
  v_rate := case when v_cached then round(v_price * (1 - v_disc), 4) else v_price end;
  -- Our marginal cost: a cache hit skips OpenAI + website + reviews enrichment (only ads refresh).
  v_cost := case when v_cached then 0.005 else 0.03 end;

  update org_billing
    set credits_remaining = greatest(0, coalesce(credits_remaining, 0) - v_rate), updated_at = now()
    where org_id = new.org_id;
  update batches set credit_cost = coalesce(credit_cost, 0) + v_cost where id = new.batch_id;

  return new;
end $$;

drop trigger if exists trg_meter_lead_credit on leads;
create trigger trg_meter_lead_credit after insert on leads for each row execute function meter_lead_credit();
