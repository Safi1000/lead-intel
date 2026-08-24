-- ============================================================================
-- HVAC / Home Services niche calibration.
--
-- The `hvac` verticals row was only stub-seeded (4 HVAC-only search terms, a 7-entry
-- exclude_types list containing the INVALID Google type `med_spa`, and an HVAC-only prompt).
-- This broadens it into a full residential home-services niche covering all the trades that
-- buy websites / lead-gen: HVAC, roofing, plumbing, electrical, landscaping, remodeling,
-- painting, garage doors, pest control, flooring, fencing, concrete, gutters, tree service,
-- pressure washing, restoration, windows, decks, handyman, solar.
--
-- exclude_types is matched against a place's Google Places (New) primaryType to skip obvious
-- out-of-niche businesses BEFORE paying for Place Details + website scan + OpenAI. So every
-- entry MUST be a REAL Google Places (New) type string. The trade types that ARE our niche
-- (plumber, electrician, roofing_contractor, general_contractor, painter, landscaper, etc.)
-- are deliberately NOT excluded. We only exclude clearly non-contractor businesses that these
-- broad trade searches can incidentally surface (stores, suppliers, auto, real estate, etc.).
--
-- Booking-platform (ServiceTitan / Housecall Pro / Jobber …), templated-vendor, and AI niche
-- tuning ship in the pipeline-run code (_website.ts NICHE_WEB_CONFIG.hvac + _ai.ts NICHE_TUNING)
-- and deploy with the engine — not here.
-- ============================================================================
update verticals
  set search_terms = array[
    'hvac contractor','air conditioning repair','heating and cooling','furnace repair',
    'roofing contractor','roof repair',
    'plumber','plumbing services',
    'electrician','electrical contractor',
    'landscaping company','lawn care service',
    'general contractor','remodeling contractor',
    'painting contractor','flooring contractor',
    'garage door repair','fencing contractor','concrete contractor',
    'gutter installation','tree service','pressure washing',
    'water damage restoration','window installation','deck builder',
    'pest control','handyman services','solar installer'
  ],
  exclude_types = array[
    'hardware_store','home_improvement_store','home_goods_store','furniture_store',
    'department_store','shopping_mall','electronics_store','auto_parts_store',
    'grocery_store','convenience_store',
    'real_estate_agency','insurance_agency','car_dealer','car_repair',
    'restaurant','cafe','bar','supermarket','gas_station','bank','school','lodging',
    'gym','dentist','hair_salon','nail_salon','pharmacy','lawyer'
  ],
  niche_prompt = 'A residential home-services trade contractor — HVAC/heating & cooling, roofing, plumbing, electrical, landscaping/lawn care, general contracting & remodeling, painting, garage doors, pest control, flooring, fencing, concrete, gutters, tree service, pressure washing, restoration, windows, decks, or handyman — an established local business that sends a crew or technician to the customer''s home to do the work, which we could sell a website redesign, first website, SEO, or online lead-gen to. NOT a hardware/home-improvement store, supplier, distributor, manufacturer, real-estate agency, or online marketplace.'
  where key = 'hvac';

-- Verify after apply:
--   select key, label, array_length(search_terms,1) terms, array_length(exclude_types,1) excl
--   from verticals where key = 'hvac';
