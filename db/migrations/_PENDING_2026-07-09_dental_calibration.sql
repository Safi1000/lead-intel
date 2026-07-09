-- ============================================================================
-- Dental niche calibration — verticals.exclude_types fix.
--
-- exclude_types is matched against a place's Google Places (New) primaryType to skip obvious
-- out-of-niche businesses BEFORE paying for Place Details + website scan + OpenAI (index.ts:
-- `profile.excludeTypes.has(placeType)`). So every entry MUST be a REAL Google Places (New) type
-- string, or it's dead weight that never matches.
--
-- The seeded dental row contained `med_spa`, which is NOT a valid Google Places type (the valid
-- aesthetic type is `spa` / `skin_care_clinic`) — it never fired. This replaces the list with
-- valid types only, and broadens the skip-list to the non-dental businesses a
-- dentist/orthodontist/cosmetic-dentist search can incidentally surface. `dentist` and
-- `dental_clinic` are deliberately NOT excluded (those ARE the niche).
--
-- Booking-platform + social-signal calibration ships in the pipeline-run code (per-vertical
-- config in _website.ts) and deploys with the engine — not here.
--
-- NOT APPLIED — pending Safi's "go" (prod DB). Only the dental row changes; the validated
-- med_spa row is left untouched (its invalid entries are harmless dead weight and TXS is live).
-- ============================================================================
update verticals
  set exclude_types = array[
    'gym','fitness_center','yoga_studio','pilates_studio',
    'spa','massage','massage_spa','sauna','tanning_studio','wellness_center',
    'beauty_salon','hair_salon','hair_care','nail_salon','barber_shop',
    'chiropractor','physiotherapist','veterinary_care','pharmacy','drugstore',
    'florist'
  ]
  where key = 'dental';

-- Verify after apply (should return the new array, 21 elements, no 'med_spa'):
--   select key, exclude_types, array_length(exclude_types,1) from verticals where key = 'dental';
