-- ============================================================================
-- MULTI-TENANT SOURCING ENGINE — per-tenant niche/geo/fields + wallet pricing + shared cache
-- STATUS: APPLIED to prod 2026-07-08 (+ pipeline-run/_ai.ts deployed same day).
--
-- Per-tenant CORRECTNESS: each tenant gets its own niche + metros + field toggles, its own dedup
--   (sourced_places(org_id, place_id)), and a prepaid wallet billed at the sell price.
-- Shared enrichment CACHE (place_cache): a place's heavy analysis (website scan + AI score) is
--   stored once per (place, niche) and reused across same-niche tenants for CACHE_TTL_DAYS (30),
--   so overlapping metros are near-free. Volatile signals (ads) still refresh per delivery.
-- ============================================================================

-- 1) Curated verticals (TechxServe-managed). vertical = niche label + default terms + skip-list +
--    the AI niche description slotted into the shared (niche-agnostic) scoring prompt.
create table if not exists verticals (
  key text primary key,
  label text not null,
  search_terms text[] not null default '{}',
  exclude_types text[] not null default '{}',
  niche_prompt text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into verticals (key, label, search_terms, exclude_types, niche_prompt) values (
  'med_spa', 'Med Spa',
  array['med spa','medical spa','aesthetic clinic','botox clinic','skin clinic'],
  array['gym','fitness_center','yoga_studio','pilates_studio','dentist','dental_clinic','dental_lab','orthodontist','hair_salon','barber_shop','nail_salon','tattoo_parlor','chiropractor','physiotherapist','physical_therapy_clinic','tanning_studio','veterinary_care','pet_groomer','florist','pharmacy'],
  'A medical or aesthetic spa offering Botox, fillers, laser, skin/anti-aging — an established local business we could sell a website redesign or lead-gen to.'
) on conflict (key) do nothing;
-- Starter verticals for other agencies (terms/skip-lists are sensible defaults; tune per demand).
insert into verticals (key, label, search_terms, exclude_types, niche_prompt) values
  ('dental', 'Dental Clinic',
   array['dentist','dental clinic','family dentistry','cosmetic dentist','orthodontist'],
   array['gym','med_spa','nail_salon','hair_salon','pharmacy','veterinary_care','physiotherapist'],
   'A general/cosmetic dental or orthodontic practice — an established local business we could sell a website redesign or lead-gen to.'),
  ('hvac', 'HVAC / Home Services',
   array['hvac contractor','air conditioning repair','heating and cooling','furnace repair'],
   array['gym','med_spa','dentist','nail_salon','hair_salon','restaurant','pharmacy'],
   'A residential HVAC / heating-and-cooling contractor — an established local service business we could sell a website redesign or lead-gen to.'),
  ('law_firm', 'Law Firm',
   array['law firm','personal injury lawyer','family law attorney','criminal defense attorney'],
   array['gym','med_spa','dentist','nail_salon','hair_salon','restaurant'],
   'A small/mid law practice (personal injury, family, criminal, etc.) — an established local firm we could sell a website redesign or lead-gen to.')
on conflict (key) do nothing;

-- 2) Per-tenant sourcing profile (self-serve). No row => engine uses its historic global config.
create table if not exists sourcing_profiles (
  org_id uuid primary key,
  vertical_key text references verticals(key),
  search_terms text[],                  -- null = vertical defaults
  metros text[] not null default '{}',  -- curated locations this tenant sources
  fetch_ads boolean not null default true,
  fetch_email boolean not null default true,
  fetch_hours boolean not null default true,
  daily_limit int not null default 1000,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table sourcing_profiles enable row level security;
drop policy if exists sourcing_profiles_rw on sourcing_profiles;
create policy sourcing_profiles_rw on sourcing_profiles for all
  using (is_sa() OR (org_id = jwt_org() AND jwt_role() in ('owner','manager')))
  with check (is_sa() OR (org_id = jwt_org() AND jwt_role() in ('owner','manager')));

-- 3) Per-tenant dedup marker on sourced_places. NOTE (verified 2026-07-08): sourced_places PK is
--    on place_id ALONE (global). Single-tenant TXS is unaffected. BEFORE onboarding tenant #2, a
--    dedicated migration must: drop sourced_places_pkey, add PK (org_id, place_id), AND scope every
--    engine/reviews-finalize UPDATE ... WHERE place_id=X by org_id too (else cross-tenant row bleed).
--    FKs: none reference sourced_places; org_id is NOT NULL on all rows — so that change is clean.
--    This redundant index is harmless today and documents the intended key.
create unique index if not exists sourced_places_org_place_uidx on sourced_places (org_id, place_id);

-- 3b) Global enrichment cache. One heavy analysis per (place, niche), reused across same-niche
--     tenants within CACHE_TTL_DAYS (engine constant = 30). website_result is niche-agnostic but
--     the ai_score is niche-specific, so the key includes vertical_key.
create table if not exists place_cache (
  place_id text not null,
  vertical_key text not null,
  website_result jsonb,
  ai_score jsonb,
  enriched_at timestamptz not null default now(),
  primary key (place_id, vertical_key)
);
create index if not exists place_cache_enriched_idx on place_cache (enriched_at);
-- Service-role only (engine writes/reads it); no anon/authenticated access needed.
alter table place_cache enable row level security;

-- 4) Wallet / pricing on org_billing. price_per_lead is the SELL price; the trigger debits the
--    wallet by it for every engine-sourced lead of a METERED org. Cost (~$0.03) tallies on the batch
--    for margin. cached_discount is reserved for Phase 2 (unused now).
alter table org_billing add column if not exists cached_discount numeric not null default 0.10;

create or replace function meter_lead_credit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_metered boolean; v_price numeric; v_cost numeric := 0.03; v_engine boolean;
begin
  if new.batch_id is null then return new; end if;
  select metered, coalesce(price_per_lead, 0.25) into v_metered, v_price from org_billing where org_id = new.org_id;
  if not coalesce(v_metered, false) then return new; end if;            -- un-metered: unlimited/free
  select (b.created_by = 'pipeline') into v_engine from batches b where b.id = new.batch_id;
  if not coalesce(v_engine, false) then return new; end if;             -- only engine leads bill
  update org_billing set credits_remaining = greatest(0, coalesce(credits_remaining,0) - v_price), updated_at = now()
    where org_id = new.org_id;
  update batches set credit_cost = coalesce(credit_cost,0) + v_cost where id = new.batch_id;
  return new;
end $$;
drop trigger if exists trg_meter_lead_credit on leads;
create trigger trg_meter_lead_credit after insert on leads for each row execute function meter_lead_credit();

-- 5) TXS = unlimited (metered=false, huge balance). Set price for reference.
insert into org_billing (org_id, metered, credits_remaining, price_per_lead)
  values ('e64c6781-3a67-4e19-8bed-e15f621075f6', false, 9999999, 0.25)
  on conflict (org_id) do update set credits_remaining = 9999999, metered = false;

-- TXS is a first-class tenant too (eats its own dog food): med_spa vertical, empty metros = the full
-- global city pool (matches today's behaviour), daily_limit high enough to stay effectively uncapped.
insert into sourcing_profiles (org_id, vertical_key, metros, daily_limit, active)
  values ('e64c6781-3a67-4e19-8bed-e15f621075f6', 'med_spa', '{}', 1000000, true)
  on conflict (org_id) do nothing;
