-- ============================================================================
-- cache_preview(): count of already-cached, importable, not-yet-delivered leads
-- for an org's niche + requested cities. Drives the pre-run "Enjoy 10% off on N
-- leads this run" banner (cached leads bill at 0.9 credits; the word "cached" is
-- never shown to the customer).
--
-- APPLIED (verified live 2026-08-10). Read-only. Called by
-- /api/pipeline/cache-preview via the service role (RLS bypassed), which returns
-- { available: 0 } gracefully until this function exists.
--
-- Notes:
--  * Importable = same rule the engine's import gate uses on the cached ai_score:
--    correct niche AND (weak site & not low_fit) OR no-website. (Reachability isn't
--    cached — phone lives in Google details — so this is a deliberate slight over-count;
--    the engine applies the exact per-lead discount at run time.)
--  * City match is best-effort on the city part of each "City, Country" metro string
--    against sourced_places.search_location (the place's first-sourced location). Empty
--    metros = any city.
-- ============================================================================
create or replace function cache_preview(p_org_id uuid, p_vertical_key text, p_metros text[])
returns integer
language sql
stable
set search_path = public
as $$
  select count(*)::int
  from place_cache pc
  join sourced_places sp on sp.place_id = pc.place_id
  where pc.vertical_key = coalesce(nullif(p_vertical_key, ''), 'med_spa')
    and pc.enriched_at > now() - interval '30 days'                       -- within the reuse TTL
    and (pc.ai_score->>'is_correct_niche')::boolean is true               -- would actually deliver
    and (
      ( (pc.ai_score->>'website_status') = 'weak'
        and coalesce((pc.ai_score->>'low_fit')::boolean, false) = false )
      or (pc.ai_score->>'website_status') = 'none'
    )
    and not exists (                                                      -- org hasn't been delivered it
      select 1 from tenant_seen_places ts
      where ts.org_id = p_org_id and ts.place_id = pc.place_id
    )
    and (                                                                 -- in a requested city (best-effort)
      p_metros is null or array_length(p_metros, 1) is null
      or exists (
        select 1 from unnest(p_metros) m
        where sp.search_location ilike '%' || split_part(m, ',', 1) || '%'
      )
    );
$$;

comment on function cache_preview(uuid, text, text[]) is
  'Estimate of cache-eligible importable leads for org+niche+cities; drives the cached-lead (10% off) pre-run banner. Best-effort city match; exact per-lead discount is applied at run time.';

grant execute on function cache_preview(uuid, text, text[]) to service_role;
