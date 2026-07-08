-- ============================================================================
-- Multi-tenant DELIVERY hardening + permanent master archive.  APPLIED 2026-07-08.
--
-- Design: sourced_places stays the GLOBAL master (PK place_id, one row per place, permanent —
-- reviews-finalize + place-level updates keep working unchanged). Per-tenant dedup moves to
-- tenant_seen_places so each tenant processes a place at most once, ever, WITHOUT blocking a
-- second tenant from receiving a place the first already sourced. Cross-tenant enrichment reuse
-- stays in place_cache. master_leads is an append-only forever archive of every delivered lead.
-- ============================================================================

-- 1) Per-tenant "seen" ledger — the new dedup source (org-scoped). Backfilled from the existing
--    global sourced_places so current tenants (TXS) skip everything already sourced.
create table if not exists tenant_seen_places (
  org_id uuid not null,
  place_id text not null,
  seen_at timestamptz not null default now(),
  primary key (org_id, place_id)
);
insert into tenant_seen_places (org_id, place_id)
  select org_id, place_id from sourced_places where org_id is not null
  on conflict do nothing;

-- 2) Master archive — a permanent copy of EVERY lead ever delivered (any tenant, cached or fresh),
--    immune to tenant/lead deletes. Populated by an after-insert trigger on leads.
create table if not exists master_leads (
  id bigint generated always as identity primary key,
  lead_id uuid,
  org_id uuid,
  place_id text,
  display_name text,
  source_type text,
  data jsonb,
  archived_at timestamptz not null default now()
);
create index if not exists master_leads_place_idx on master_leads(place_id);
create index if not exists master_leads_org_idx on master_leads(org_id);

create or replace function archive_master_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into master_leads (lead_id, org_id, place_id, display_name, source_type, data)
  values (new.id, new.org_id, new.source_meta->>'place_id', new.display_name, new.source_type, new.data);
  return new;
end $$;
drop trigger if exists trg_archive_master_lead on leads;
create trigger trg_archive_master_lead after insert on leads for each row execute function archive_master_lead();

-- Backfill the archive from existing leads so the master is complete from day one.
insert into master_leads (lead_id, org_id, place_id, display_name, source_type, data)
  select id, org_id, source_meta->>'place_id', display_name, source_type, data from leads
  on conflict do nothing;
