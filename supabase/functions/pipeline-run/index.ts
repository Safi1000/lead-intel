/**
 * Supabase Edge Function: pipeline-run
 * Deno runtime — 150s wall-clock timeout.
 *
 * Niche: US Med Spas & Aesthetic Clinics.
 * Search terms and target metros are hardcoded here — the user only needs to
 * configure quality threshold, AI model, and max leads per run.
 *
 * Pipeline phases per lead:
 *   1. Search  — Google Places Text Search (cheap field mask) across hardcoded queries
 *   2. Dedup   — filter already-seen place_ids in one batch query
 *   3. Details — Place Details (expensive field mask, new places only)
 *   4. Website — email + quality signal analysis (_website.ts)
 *   5. AI      — OpenAI Structured Outputs scoring (_ai.ts)
 *   6. Import  — insert into leads + batches if it passes all filters
 *   7. XLSX    — full audit log uploaded to Supabase Storage
 */

import { analyzeWebsite } from './_website.ts'
import { scorePlace } from './_ai.ts'
import type { AiScore, PlaceForScoring } from './_ai.ts'

// ---------------------------------------------------------------------------
// Niche config — edit here to change what the pipeline targets
// ---------------------------------------------------------------------------

const SEARCH_TERMS = [
  'med spa',
  'medical spa',
  'aesthetic clinic',
  'botox clinic',
  'skin clinic',
]

// Top 20 US metros ranked by med spa density + spend.
// CONTIGUOUS US ONLY — Hawaii (Honolulu) and Alaska (Anchorage) are intentionally excluded
// (non-contiguous, different market/logistics). Any dynamic location source must exclude them too.
const TARGET_METROS = [
  'New York City, NY',
  'Los Angeles, CA',
  'Miami, FL',
  'Houston, TX',
  'Dallas, TX',
  'Chicago, IL',
  'Atlanta, GA',
  'Scottsdale, AZ',
  'Las Vegas, NV',
  'San Diego, CA',
  'Austin, TX',
  'Beverly Hills, CA',
  'Nashville, TN',
  'Tampa, FL',
  'Orlando, FL',
  'Charlotte, NC',
  'Denver, CO',
  'Seattle, WA',
  'Boston, MA',
  'Phoenix, AZ',
]

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GOOGLE_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY')!
const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY')!
const PIPELINE_SECRET = Deno.env.get('PIPELINE_SECRET') ?? ''

const PLACES_BASE = 'https://places.googleapis.com/v1'

// ---------------------------------------------------------------------------
// PostgREST helpers (service role)
// ---------------------------------------------------------------------------

function svcHeaders(extra: Record<string, string> = {}) {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...extra }
}

async function dbSelect<T = Record<string, unknown>>(table: string, qs: string): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: svcHeaders() })
  if (!res.ok) throw new Error(`dbSelect ${table}: ${res.status} ${await res.text()}`)
  return res.json()
}

async function dbInsert<T = Record<string, unknown>>(table: string, body: unknown): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: svcHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`dbInsert ${table}: ${res.status} ${await res.text()}`)
  return res.json()
}

async function dbUpdate(table: string, body: unknown, qs: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: 'PATCH',
    headers: svcHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify(body),
  })
  if (!res.ok) console.error(`dbUpdate ${table}: ${res.status} ${await res.text()}`)
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// ---------------------------------------------------------------------------
// Search combinations — shuffled each run for geographic diversity
// ---------------------------------------------------------------------------

function buildShuffledSearches(): Array<{ search_term: string; location: string }> {
  const combos = SEARCH_TERMS.flatMap((term) => TARGET_METROS.map((city) => ({ search_term: term, location: city })))
  // Fisher-Yates shuffle so limited runs cover diverse areas, not just the first city repeatedly
  for (let i = combos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[combos[i], combos[j]] = [combos[j], combos[i]]
  }
  return combos
}

// ---------------------------------------------------------------------------
// Chaining (large batches across many invocations)
// A "job" (target_total set) runs as a chain of chunks. Each invocation processes a
// time-boxed slice, then re-invokes itself for the next chunk until the target is met,
// combos are exhausted, or the user stops. sourced_places dedup is the natural cursor.
// ---------------------------------------------------------------------------

// Wall-clock budget per invocation — below the 150s hard limit, leaving margin for the final
// DB writes + firing the next chunk.
const CHUNK_TIME_BUDGET_MS = 110_000
// Max NEW (deduped) candidates to gather + enrich in one chunk. Keeps the search phase bounded.
const CHUNK_CANDIDATE_CAP = 60

// Fire the next chunk (the edge function invokes itself). Same race-then-return pattern the Vercel
// trigger uses, so the next isolate is in-flight before this one exits.
async function chainNextChunk(payload: Record<string, unknown>): Promise<void> {
  const fetchPromise = fetch(`${SUPABASE_URL}/functions/v1/pipeline-run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PIPELINE_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((e) => { console.error('[chain] next-chunk fetch failed:', (e as Error).message); return null })
  const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), 5000))
  await Promise.race([fetchPromise, timeout])
}

// Cumulative run totals, computed from the DB at finalize (chunk counters are per-invocation).
async function computeRunTotals(runId: string): Promise<Record<string, number>> {
  const rows = await dbSelect<{ website_status: string | null; crm_lead_id: string | null; email: string | null; website: string | null }>(
    'sourced_places', `pipeline_run_id=eq.${runId}&select=website_status,crm_lead_id,email,website`,
  )
  return {
    total_searched: rows.length,
    total_new: rows.length,
    total_enriched: rows.filter((r) => r.website).length,
    total_emailed: rows.filter((r) => r.email).length,
    total_imported: rows.filter((r) => r.crm_lead_id).length,
    total_no_website: rows.filter((r) => r.website_status === 'none').length,
  }
}

// Rebuild the export rows for a whole (chained) run from the DB, since each chunk only holds its own.
async function fetchRunXlsxRows(runId: string): Promise<Record<string, unknown>[]> {
  const rows = await dbSelect<Record<string, unknown>>(
    'sourced_places',
    `pipeline_run_id=eq.${runId}&order=created_at&select=place_id,name,address,phone,website,website_status,status_reason,is_correct_niche,site_issue_note,email,email_source,email_confidence,rating,quality_score,low_fit,pain_points,personalization_notes,search_term,search_location,error`,
  )
  return rows.map((r) => ({
    place_id: r.place_id, name: r.name, address: r.address, phone: r.phone ?? '', website: r.website ?? '',
    website_status: r.website_status ?? '', status_reason: r.status_reason ?? '', is_correct_niche: r.is_correct_niche ?? '',
    site_issue_note: r.site_issue_note ?? '', email: r.email ?? '', email_source: r.email_source ?? '', email_confidence: r.email_confidence ?? '',
    rating: r.rating ?? '', quality_score: r.quality_score ?? '', low_fit: r.low_fit ?? '', pain_points: r.pain_points ?? '',
    personalization_notes: r.personalization_notes ?? '', search_query: r.search_term ?? '', search_location: r.search_location ?? '', error: r.error ?? '',
  }))
}

// ---------------------------------------------------------------------------
// Google Places helpers
// ---------------------------------------------------------------------------

interface RawPlace {
  id: string
  displayName?: { text: string }
  formattedAddress?: string
}

interface PlaceDetails {
  id: string
  name: string
  phone: string | null
  website: string | null
  rating: number | null
  reviews: Array<{ text: string; rating: number }>
}

async function placesTextSearch(
  searchTerm: string,
  location: string,
  pageToken?: string,
): Promise<{ places: RawPlace[]; nextPageToken?: string }> {
  const body: Record<string, unknown> = { textQuery: `${searchTerm} in ${location}`, pageSize: 20 }
  if (pageToken) body.pageToken = pageToken

  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,nextPageToken',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Places searchText: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return { places: data.places ?? [], nextPageToken: data.nextPageToken }
}

async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
  const res = await fetch(`${PLACES_BASE}/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask': 'id,displayName,internationalPhoneNumber,websiteUri,rating,reviews',
    },
  })
  if (!res.ok) throw new Error(`Place Details ${placeId}: ${res.status} ${await res.text()}`)
  const d = await res.json()
  return {
    id: placeId,
    name: d.displayName?.text ?? '',
    phone: d.internationalPhoneNumber ?? null,
    website: d.websiteUri ?? null,
    rating: d.rating ?? null,
    reviews: (d.reviews ?? []).map((r: { text?: { text?: string }; rating?: number }) => ({
      text: r.text?.text ?? '',
      rating: r.rating ?? 0,
    })),
  }
}

// ---------------------------------------------------------------------------
// XLSX export
// ---------------------------------------------------------------------------

async function buildAndUploadXlsx(orgId: string, runId: string, rows: Record<string, unknown>[]): Promise<string | null> {
  try {
    // @ts-ignore — npm compat in Deno
    const XLSX = await import('npm:xlsx@0.18.5')
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Pipeline Run')
    const buf: Uint8Array = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    const path = `${orgId}/${runId}.xlsx`
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/pipeline-exports/${path}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      body: buf,
    })
    if (!uploadRes.ok) { console.error('XLSX upload failed:', await uploadRes.text()); return null }
    return path
  } catch (e) {
    console.error('XLSX build error:', e)
    return null
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (PIPELINE_SECRET && token !== PIPELINE_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }

  let body: { run_id: string; org_id: string; dry_run?: boolean; max_places?: number; target_total?: number; batch_id?: string; batch_name?: string; chunk_index?: number }
  try { body = await req.json() } catch {
    return new Response(JSON.stringify({ error: 'invalid body' }), { status: 400 })
  }

  const { run_id: runId, org_id: orgId, dry_run: dryRun = false, max_places: maxPlacesOverride,
          target_total: targetTotal, batch_id: incomingBatchId, batch_name: batchName, chunk_index: chunkIndex = 0 } = body
  if (!runId || !orgId) {
    return new Response(JSON.stringify({ error: 'run_id and org_id are required' }), { status: 400 })
  }

  // Chaining job when target_total is set: this invocation is one time-boxed chunk of a larger job.
  const chaining = targetTotal != null
  const chunkStart = Date.now()

  // Counters
  let totalSearched = 0
  let totalNew = 0
  let totalEnriched = 0
  let totalEmailed = 0
  let totalImported = 0
  let totalNoWebsite = 0
  const xlsxRows: Record<string, unknown>[] = []

  try {
    // Load org config
    const configs = await dbSelect('pipeline_config', `org_id=eq.${orgId}&limit=1`)
    const cfg = configs[0] ?? { quality_threshold: 6, max_places_per_run: 100, openai_model: 'gpt-4o-mini' }
    const cfgMax = maxPlacesOverride ?? Number(cfg.max_places_per_run ?? 100)
    const qualityThreshold = Number(cfg.quality_threshold ?? 6)
    const model: string = (cfg.openai_model as string) ?? 'gpt-4o-mini'

    // How many to gather+enrich in THIS chunk. Legacy runs use the configured cap directly;
    // chaining chunks take min(remaining toward target, per-chunk cap).
    let processedSoFar = 0
    if (chaining) {
      const runRows = await dbSelect<{ processed_total: number }>('pipeline_runs', `id=eq.${runId}&select=processed_total`)
      processedSoFar = Number(runRows[0]?.processed_total ?? 0)
    }
    const remaining = chaining ? Math.max(0, (targetTotal as number) - processedSoFar) : cfgMax
    const maxPlaces = chaining ? Math.min(remaining, CHUNK_CANDIDATE_CAP) : cfgMax

    // -------------------------------------------------------------------------
    // Phase 1: SEARCH — iterate shuffled combos until maxPlaces reached
    // -------------------------------------------------------------------------
    type RawResult = RawPlace & { _search_term: string; _location: string; _address: string; _name: string }
    const allResults: RawResult[] = []
    const searches = buildShuffledSearches()

    for (const search of searches) {
      if (allResults.length >= maxPlaces) break
      try {
        let pageToken: string | undefined
        do {
          const { places, nextPageToken } = await placesTextSearch(search.search_term, search.location, pageToken)
          for (const p of places) {
            allResults.push({
              ...p,
              _search_term: search.search_term,
              _location: search.location,
              _name: p.displayName?.text ?? '',
              _address: p.formattedAddress ?? '',
            })
            if (allResults.length >= maxPlaces) break
          }
          pageToken = nextPageToken
          if (places.length === 0) break
        } while (pageToken && allResults.length < maxPlaces)
      } catch (e) {
        console.error(`Search "${search.search_term} in ${search.location}" failed:`, (e as Error).message)
      }
    }

    totalSearched = allResults.length

    // -------------------------------------------------------------------------
    // Phase 2: DEDUP — one batch query, filter already-seen place_ids
    // -------------------------------------------------------------------------
    const allPlaceIds = allResults.map((r) => r.id)
    let newResults = allResults

    if (allPlaceIds.length > 0) {
      const existing = await dbSelect<{ place_id: string }>(
        'sourced_places',
        `place_id=in.(${allPlaceIds.map((id) => `"${id}"`).join(',')})&select=place_id`,
      )
      const existingSet = new Set(existing.map((r) => r.place_id))
      newResults = allResults.filter((r) => !existingSet.has(r.id))
    }
    // De-dup within this batch too — the same place can surface from multiple search combos.
    newResults = [...new Map(newResults.map((r) => [r.id, r])).values()]

    totalNew = newResults.length
    // Legacy runs report totals per run; chaining jobs report cumulative progress via processed_total.
    if (!chaining) await dbUpdate('pipeline_runs', { total_searched: totalSearched, total_new: totalNew }, `id=eq.${runId}`)

    // -------------------------------------------------------------------------
    // Prepare CRM batch. Chaining jobs reuse ONE named batch across all chunks (created by the
    // trigger and passed in as batch_id); legacy runs create their own.
    // -------------------------------------------------------------------------
    let batchId: string | null = incomingBatchId ?? null
    if (!dryRun && newResults.length > 0 && !batchId) {
      const batches = await dbInsert<{ id: string }>('batches', {
        org_id: orgId,
        template_id: null,
        template_name: 'Google Maps Pipeline',
        file_name: batchName ?? `Pipeline Run ${runId.slice(0, 8)}`,
        total_rows: newResults.length,
        imported_count: 0,
        rejected_count: 0,
        created_by: 'pipeline',
      })
      batchId = batches[0]?.id ?? null
    }

    // -------------------------------------------------------------------------
    // Phases 3-6: Per-lead enrichment (each in its own try/catch)
    // -------------------------------------------------------------------------
    const leadsToInsert: Record<string, unknown>[] = []
    let stopped = false
    let processedThisChunk = 0

    // Process leads in bounded-concurrency batches. Per-lead work is mostly waiting on the website
    // fetch + OpenAI, so running LEAD_CONCURRENCY at once overlaps those waits (~6x faster) while
    // staying well within Google Places / OpenAI rate limits. Shared counters/arrays are safe to
    // mutate from the callbacks (JS is single-threaded; mutations happen between awaits).
    const LEAD_CONCURRENCY = 6
    for (let batchStart = 0; batchStart < newResults.length; batchStart += LEAD_CONCURRENCY) {
      // Stop check (once per batch)
      const runRows = await dbSelect<{ stop_requested: boolean }>('pipeline_runs', `id=eq.${runId}&select=stop_requested`)
      if (runRows[0]?.stop_requested) {
        console.log(`[pipeline-run] stop requested at lead ${batchStart}, exiting cleanly`)
        stopped = true
        break
      }
      // Time-box the chunk so a chaining job never hits the 150s limit — the next chunk continues.
      if (chaining && Date.now() - chunkStart > CHUNK_TIME_BUDGET_MS) {
        console.log(`[pipeline-run] chunk ${chunkIndex} hit time budget at lead ${batchStart}/${newResults.length}`)
        break
      }

      await Promise.all(newResults.slice(batchStart, batchStart + LEAD_CONCURRENCY).map(async (result) => {
      processedThisChunk++

      const placeId = result.id
      let details: PlaceDetails | null = null
      let aiScore: AiScore | null = null
      let aiRaw: unknown = null
      let rowError: string | null = null

      // Phase 3: Place Details (expensive — only for new places)
      try {
        details = await getPlaceDetails(placeId)
        totalEnriched++
      } catch (e) {
        rowError = `Place Details failed: ${(e as Error).message}`
        console.error(`[${placeId}] ${rowError}`)
      }

      // ---- No-website fast path ----
      // If Google Maps has no website for this place, record it separately and move on.
      // We'll revisit these leads later with a different pitch (build-from-scratch).
      if (!details?.website) {
        totalNoWebsite++
        try {
          await dbInsert('sourced_places', {
            place_id: placeId,
            org_id: orgId,
            pipeline_run_id: runId,
            search_term: result._search_term,
            search_location: result._location,
            name: details?.name ?? result._name,
            address: result._address,
            phone: details?.phone ?? null,
            website: null,
            rating: details?.rating ?? null,
            website_status: 'none',
            is_correct_niche: null,
            error: rowError,
          })
        } catch (e) {
          console.error(`[${placeId}] sourced_places insert (no-website) failed:`, (e as Error).message)
        }
        xlsxRows.push({
          place_id: placeId,
          name: details?.name ?? result._name,
          address: result._address,
          phone: details?.phone ?? '',
          website: '',
          website_status: 'none',
          is_correct_niche: '',
          site_issue_note: '',
          email: '',
          rating: details?.rating ?? '',
          quality_score: '',
          low_fit: '',
          pain_points: '',
          personalization_notes: '',
          search_query: result._search_term,
          search_location: result._location,
          error: rowError ?? 'No website on Google Maps',
        })
        return
      }

      // Insert into sourced_places now (marks place as seen even if later steps fail)
      try {
        await dbInsert('sourced_places', {
          place_id: placeId,
          org_id: orgId,
          pipeline_run_id: runId,
          search_term: result._search_term,
          search_location: result._location,
          name: details.name,
          address: result._address,
          phone: details.phone,
          website: details.website,
          rating: details.rating,
          error: rowError,
        })
      } catch (e) {
        console.error(`[${placeId}] sourced_places insert failed:`, (e as Error).message)
        return
      }

      // Phase 4: Website analysis (email + quality signals)
      let emailResult = { email: null as string | null, emailSource: 'none' as string, emailConfidence: 'none' as string }
      let websiteResult = null
      try {
        websiteResult = await analyzeWebsite(details.website)
        if (websiteResult.email) {
          emailResult = { email: websiteResult.email, emailSource: websiteResult.emailSource, emailConfidence: websiteResult.emailConfidence }
          totalEmailed++
        }
      } catch (e) {
        console.error(`[${placeId}] website analysis failed:`, (e as Error).message)
      }

      // Phase 5: AI scoring
      try {
        const placeForAi: PlaceForScoring = {
          name: details.name,
          address: result._address,
          phone: details.phone,
          website: details.website,
          rating: details.rating,
          reviews: details.reviews,
          email: emailResult.email,
          websiteSignals: websiteResult,
        }
        const { score, raw } = await scorePlace(placeForAi, qualityThreshold, model, OPENAI_KEY)
        aiScore = score
        aiRaw = raw
      } catch (e) {
        console.error(`[${placeId}] AI scoring failed:`, (e as Error).message)
        rowError = (rowError ? rowError + '; ' : '') + `AI failed: ${(e as Error).message}`
      }

      // Update sourced_places with all enriched data
      try {
        await dbUpdate(
          'sourced_places',
          {
            email: emailResult.email,
            email_source: emailResult.emailSource,
            email_confidence: emailResult.emailConfidence,
            website_status: aiScore?.website_status ?? 'unknown',
            status_reason: aiScore?.status_reason ?? null,
            is_correct_niche: aiScore?.is_correct_niche ?? null,
            site_issue_note: aiScore?.site_issue_note ?? null,
            pain_points: aiScore?.pain_points ?? null,
            quality_score: aiScore?.quality_score ?? null,
            low_fit: aiScore?.low_fit ?? null,
            personalization_notes: aiScore?.personalization_notes ?? null,
            ai_raw: aiRaw,
            error: rowError,
          },
          `place_id=eq.${placeId}`,
        )
      } catch (e) {
        console.error(`[${placeId}] sourced_places update failed:`, (e as Error).message)
      }

      // Phase 6: Import decision
      // Only import if: right niche + bad website + passes quality threshold + reachable (has email or phone)
      const shouldImport = aiScore
        && aiScore.is_correct_niche
        && aiScore.website_status === 'weak'
        && !aiScore.low_fit
        && (emailResult.email || details.phone)

      if (!dryRun && batchId && shouldImport) {
        leadsToInsert.push({
          org_id: orgId,
          batch_id: batchId,
          template_id: null,
          template_name: 'Google Maps Pipeline',
          display_name: details.name,
          status: 'new',
          source_type: 'google_maps',
          source_meta: { search_query: result._search_term, search_location: result._location, website_status: aiScore.website_status },
          data: {
            'Business Name': details.name,
            'Address': result._address,
            'Phone': details.phone ?? '',
            'Website': details.website ?? '',
            'Email': emailResult.email ?? '',
            'Rating': details.rating != null ? String(details.rating) : '',
            'Website Status': aiScore?.website_status ?? '',
            'Why This Status': aiScore?.status_reason ?? '',
            'Site Issue Note': aiScore?.site_issue_note ?? '',
            'Pain Points': aiScore?.pain_points ?? '',
            'Quality Score': aiScore?.quality_score != null ? String(aiScore.quality_score) : '',
            'Personalization Notes': aiScore?.personalization_notes ?? '',
            'Source': 'Google Maps Pipeline',
            'Search Query': result._search_term,
            'Search Location': result._location,
          },
          created_by: 'pipeline',
        })
      } else if (dryRun) {
        const verdict = !aiScore ? 'no AI score'
          : !aiScore.is_correct_niche ? 'wrong niche'
          : aiScore.website_status !== 'weak' ? `website_status=${aiScore.website_status}`
          : aiScore.low_fit ? `low_fit (score ${aiScore.quality_score})`
          : !(emailResult.email || details.phone) ? 'not reachable'
          : 'WOULD IMPORT'
        console.log(`[dry-run] ${details.name} | ${verdict} | email: ${emailResult.email ?? 'none'}`)
      }

      xlsxRows.push({
        place_id: placeId,
        name: details.name,
        address: result._address,
        phone: details.phone ?? '',
        website: details.website,
        website_status: aiScore?.website_status ?? '',
        status_reason: aiScore?.status_reason ?? '',
        is_correct_niche: aiScore?.is_correct_niche ?? '',
        site_issue_note: aiScore?.site_issue_note ?? '',
        email: emailResult.email ?? '',
        email_source: emailResult.emailSource,
        email_confidence: emailResult.emailConfidence,
        rating: details.rating ?? '',
        quality_score: aiScore?.quality_score ?? '',
        low_fit: aiScore?.low_fit ?? '',
        pain_points: aiScore?.pain_points ?? '',
        personalization_notes: aiScore?.personalization_notes ?? '',
        search_query: result._search_term,
        search_location: result._location,
        error: rowError ?? '',
      })
      }))
    }

    // Batch-insert leads (500 at a time)
    if (!dryRun && leadsToInsert.length > 0) {
      for (const part of chunk(leadsToInsert, 500)) {
        try {
          const inserted = await dbInsert<{ id: string }>('leads', part)
          for (let i = 0; i < inserted.length; i++) {
            const lead = inserted[i]
            const name = (part[i] as { display_name?: string }).display_name ?? ''
            if (lead?.id && name) {
              await dbUpdate(
                'sourced_places',
                { crm_lead_id: lead.id, imported_at: new Date().toISOString() },
                `pipeline_run_id=eq.${runId}&name=eq.${encodeURIComponent(name)}`,
              )
            }
          }
          totalImported += inserted.length
        } catch (e) {
          console.error('Leads batch insert failed:', (e as Error).message)
        }
      }
      // Legacy runs set the batch count now; chaining jobs set the cumulative count at finalize.
      if (batchId && !chaining) await dbUpdate('batches', { imported_count: totalImported }, `id=eq.${batchId}`)
    }

    // -------------------------------------------------------------------------
    // Chain the next chunk, or finalize.
    // -------------------------------------------------------------------------
    const newProcessedTotal = processedSoFar + processedThisChunk
    const foundNew = newResults.length > 0
    const targetMet = chaining && newProcessedTotal >= (targetTotal as number)
    const exhausted = chaining && !foundNew // a full search pass that surfaced no new places
    const shouldChain = chaining && !stopped && !targetMet && !exhausted

    if (shouldChain) {
      await dbUpdate('pipeline_runs', {
        status: 'running',
        processed_total: newProcessedTotal,
        chunk_index: chunkIndex + 1,
        batch_id: batchId,
        last_progress_at: new Date().toISOString(), // heartbeat for the stall watchdog
      }, `id=eq.${runId}`)
      await chainNextChunk({
        run_id: runId, org_id: orgId, dry_run: dryRun,
        target_total: targetTotal, batch_id: batchId, batch_name: batchName, chunk_index: chunkIndex + 1,
      })
      console.log(`[pipeline-run] chunk ${chunkIndex} done (${processedThisChunk} leads, ${newProcessedTotal}/${targetTotal}) → chained next`)
      return new Response(JSON.stringify({ ok: true, run_id: runId, chunk: chunkIndex, processed: newProcessedTotal, chaining: true }), { status: 200 })
    }

    // FINALIZE — legacy single run, or the last chunk of a chaining job.
    const finalTotals = chaining
      ? await computeRunTotals(runId)
      : { total_searched: totalSearched, total_new: totalNew, total_enriched: totalEnriched, total_emailed: totalEmailed, total_imported: totalImported, total_no_website: totalNoWebsite }

    if (batchId) await dbUpdate('batches', { imported_count: finalTotals.total_imported, total_rows: finalTotals.total_new }, `id=eq.${batchId}`)

    // XLSX audit log (upload even on partial/stopped runs). Chaining rebuilds from the DB.
    const exportRows = chaining ? await fetchRunXlsxRows(runId) : xlsxRows
    let xlsxPath: string | null = null
    if (exportRows.length > 0) xlsxPath = await buildAndUploadXlsx(orgId, runId, exportRows)

    await dbUpdate('pipeline_runs', {
      status: stopped ? 'stopped' : 'completed',
      completed_at: new Date().toISOString(),
      processed_total: newProcessedTotal,
      chunk_index: chunkIndex + 1,
      batch_id: batchId,
      ...finalTotals,
      xlsx_path: xlsxPath,
    }, `id=eq.${runId}`)

    return new Response(JSON.stringify({ ok: true, run_id: runId, processed: newProcessedTotal, chaining }), { status: 200 })

  } catch (e) {
    const msg = (e as Error).message ?? 'Unknown error'
    console.error('[pipeline-run] fatal:', msg)
    await dbUpdate('pipeline_runs', {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: msg,
    }, `id=eq.${runId}`).catch(() => {})
    return new Response(JSON.stringify({ error: msg }), { status: 500 })
  }
})
