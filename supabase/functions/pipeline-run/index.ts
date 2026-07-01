/**
 * Supabase Edge Function: pipeline-run
 * Deno runtime — 150s wall-clock timeout on free tier.
 *
 * Called by api/pipeline/run.ts (fire-and-forget). Runs all pipeline phases:
 *   1. Search  — Google Places Text Search (cheap field mask)
 *   2. Dedup   — filter already-seen place_ids
 *   3. Enrich  — Place Details (expensive field mask, new places only)
 *   4. Email   — in-house website scrape
 *   5. AI      — OpenAI Structured Outputs scoring
 *   6. Import  — insert into leads + batches (skipped in dry_run)
 *   7. XLSX    — audit log uploaded to Supabase Storage
 */

import { extractEmail } from './_email.ts'
import { scorePlace } from './_ai.ts'
import type { PlaceForScoring } from './_ai.ts'

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

// Chunk array for batch inserts
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// ---------------------------------------------------------------------------
// Google Places helpers
// ---------------------------------------------------------------------------
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

async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
  const res = await fetch(`${PLACES_BASE}/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask': 'id,displayName,internationalPhoneNumber,websiteUri,rating,reviews',
    },
  })
  if (!res.ok) throw new Error(`Place Details ${placeId}: ${res.status} ${await res.text()}`)
  const d = await res.json()
  const reviews = (d.reviews ?? []).map((r: { text?: { text?: string }; rating?: number }) => ({
    text: r.text?.text ?? '',
    rating: r.rating ?? 0,
  }))
  return {
    id: placeId,
    name: d.displayName?.text ?? '',
    phone: d.internationalPhoneNumber ?? null,
    website: d.websiteUri ?? null,
    rating: d.rating ?? null,
    reviews,
  }
}

// ---------------------------------------------------------------------------
// XLSX export via Supabase Storage
// ---------------------------------------------------------------------------
async function buildAndUploadXlsx(
  orgId: string,
  runId: string,
  rows: Record<string, unknown>[],
): Promise<string | null> {
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
    if (!uploadRes.ok) {
      console.error('XLSX upload failed:', await uploadRes.text())
      return null
    }
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
  // Auth check
  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (PIPELINE_SECRET && token !== PIPELINE_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }

  let body: { run_id: string; org_id: string; dry_run?: boolean }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid body' }), { status: 400 })
  }

  const { run_id: runId, org_id: orgId, dry_run: dryRun = false } = body
  if (!runId || !orgId) {
    return new Response(JSON.stringify({ error: 'run_id and org_id are required' }), { status: 400 })
  }

  // Counters
  let totalSearched = 0
  let totalNew = 0
  let totalEnriched = 0
  let totalEmailed = 0
  let totalImported = 0
  const xlsxRows: Record<string, unknown>[] = []

  try {
    // Load config
    const [configs, searches] = await Promise.all([
      dbSelect('pipeline_config', `org_id=eq.${orgId}&limit=1`),
      dbSelect('pipeline_searches', `org_id=eq.${orgId}&enabled=eq.true`),
    ])
    const cfg = configs[0] ?? { icp_rubric: '', quality_threshold: 6, max_places_per_run: 100, openai_model: 'gpt-4o-mini' }
    const maxPlaces: number = Number(cfg.max_places_per_run ?? 100)
    const qualityThreshold: number = Number(cfg.quality_threshold ?? 6)
    const icpRubric: string = cfg.icp_rubric ?? ''
    const model: string = cfg.openai_model ?? 'gpt-4o-mini'

    // ------------------------------------------------------------------
    // Phase 1: SEARCH — collect place_ids + basic info across all searches
    // ------------------------------------------------------------------
    type RawResult = RawPlace & { _search_term: string; _location: string; _address: string; _name: string }
    const allResults: RawResult[] = []

    for (const search of searches) {
      if (allResults.length >= maxPlaces) break
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
    }

    totalSearched = allResults.length

    // ------------------------------------------------------------------
    // Phase 2: DEDUP — filter already-seen place_ids (one batch query)
    // ------------------------------------------------------------------
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

    totalNew = newResults.length

    // Update run with search counts so far
    await dbUpdate('pipeline_runs', { total_searched: totalSearched, total_new: totalNew }, `id=eq.${runId}`)

    // ------------------------------------------------------------------
    // Prepare batch for import (one batch per run, created once)
    // ------------------------------------------------------------------
    let batchId: string | null = null
    if (!dryRun && newResults.length > 0) {
      const batches = await dbInsert<{ id: string }>('batches', {
        org_id: orgId,
        template_id: null,
        template_name: 'Google Maps Pipeline',
        file_name: `Pipeline Run ${runId.slice(0, 8)}`,
        total_rows: newResults.length,
        imported_count: 0,
        rejected_count: 0,
        created_by: 'pipeline',
      })
      batchId = batches[0]?.id ?? null
    }

    // ------------------------------------------------------------------
    // Phases 3-7: Per-lead enrichment (each in its own try/catch)
    // ------------------------------------------------------------------
    const leadsToInsert: Record<string, unknown>[] = []

    for (const result of newResults) {
      const placeId = result.id
      let details: PlaceDetails | null = null
      let emailResult = { email: null as string | null, source: 'none' as string, confidence: 'none' as string }
      let aiScore = null as { pain_points: string; quality_score: number; low_fit: boolean; personalization_notes: string } | null
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

      // Insert into sourced_places now (marks place as seen even if later steps fail)
      try {
        await dbInsert('sourced_places', {
          place_id: placeId,
          org_id: orgId,
          pipeline_run_id: runId,
          search_term: result._search_term,
          search_location: result._location,
          name: details?.name ?? result._name,
          address: details ? null : result._address, // details.formattedAddress not fetched; use search result
          phone: details?.phone ?? null,
          website: details?.website ?? null,
          rating: details?.rating ?? null,
          error: rowError,
        })
      } catch (e) {
        console.error(`[${placeId}] sourced_places insert failed:`, (e as Error).message)
        continue
      }

      if (!details) {
        xlsxRows.push({ place_id: placeId, name: result._name, address: result._address, error: rowError })
        continue
      }

      // Phase 4: Email extraction
      if (details.website) {
        try {
          emailResult = await extractEmail(details.website)
          if (emailResult.email) totalEmailed++
        } catch (e) {
          console.error(`[${placeId}] email extraction failed:`, (e as Error).message)
        }
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
        }
        const { score, raw } = await scorePlace(placeForAi, icpRubric, qualityThreshold, model, OPENAI_KEY)
        aiScore = score
        aiRaw = raw
      } catch (e) {
        console.error(`[${placeId}] AI scoring failed:`, (e as Error).message)
        rowError = (rowError ? rowError + '; ' : '') + `AI failed: ${(e as Error).message}`
      }

      // Update sourced_places with enriched data
      try {
        await dbUpdate(
          'sourced_places',
          {
            email: emailResult.email,
            email_source: emailResult.source,
            email_confidence: emailResult.confidence,
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

      // Phase 6: Import to leads
      if (!dryRun && batchId) {
        leadsToInsert.push({
          org_id: orgId,
          batch_id: batchId,
          template_id: null,
          template_name: 'Google Maps Pipeline',
          display_name: details.name,
          status: 'new',
          source_type: 'google_maps',
          source_meta: { search_query: result._search_term, search_location: result._location },
          data: {
            'Business Name': details.name,
            'Address': result._address,
            'Phone': details.phone ?? '',
            'Website': details.website ?? '',
            'Email': emailResult.email ?? '',
            'Rating': details.rating != null ? String(details.rating) : '',
            'Pain Points': aiScore?.pain_points ?? '',
            'Quality Score': aiScore?.quality_score != null ? String(aiScore.quality_score) : '',
            'Personalization Notes': aiScore?.personalization_notes ?? '',
            'Source': 'google_maps',
            'Search Query': result._search_term,
            'Search Location': result._location,
          },
          created_by: 'pipeline',
        })
      } else if (dryRun) {
        console.log('[dry-run] would import:', details.name, '| score:', aiScore?.quality_score, '| email:', emailResult.email)
      }

      // Accumulate for XLSX
      xlsxRows.push({
        place_id: placeId,
        name: details.name,
        address: result._address,
        phone: details.phone ?? '',
        website: details.website ?? '',
        email: emailResult.email ?? '',
        email_source: emailResult.source,
        email_confidence: emailResult.confidence,
        rating: details.rating ?? '',
        pain_points: aiScore?.pain_points ?? '',
        quality_score: aiScore?.quality_score ?? '',
        low_fit: aiScore?.low_fit ?? '',
        personalization_notes: aiScore?.personalization_notes ?? '',
        search_query: result._search_term,
        search_location: result._location,
        error: rowError ?? '',
      })
    }

    // Batch insert leads (500 at a time, same as endpoints.ts pattern)
    if (!dryRun && leadsToInsert.length > 0) {
      const leadChunks = chunk(leadsToInsert, 500)
      for (const part of leadChunks) {
        try {
          const inserted = await dbInsert<{ id: string }>('leads', part)
          // Back-link crm_lead_id in sourced_places
          for (let i = 0; i < inserted.length; i++) {
            const lead = inserted[i]
            const sourcedName = (part[i] as { display_name?: string }).display_name ?? ''
            if (lead?.id && sourcedName) {
              // Match by name within this run
              await dbUpdate(
                'sourced_places',
                { crm_lead_id: lead.id, imported_at: new Date().toISOString() },
                `pipeline_run_id=eq.${runId}&name=eq.${encodeURIComponent(sourcedName)}`,
              )
            }
          }
          totalImported += inserted.length
        } catch (e) {
          console.error('Leads batch insert failed:', (e as Error).message)
        }
      }

      // Update batch imported_count
      if (batchId) {
        await dbUpdate('batches', { imported_count: totalImported }, `id=eq.${batchId}`)
      }
    }

    // Phase 7: XLSX export
    let xlsxPath: string | null = null
    if (xlsxRows.length > 0) {
      xlsxPath = await buildAndUploadXlsx(orgId, runId, xlsxRows)
    }

    // Finalize run
    await dbUpdate('pipeline_runs', {
      status: 'completed',
      completed_at: new Date().toISOString(),
      total_searched: totalSearched,
      total_new: totalNew,
      total_enriched: totalEnriched,
      total_emailed: totalEmailed,
      total_imported: totalImported,
      xlsx_path: xlsxPath,
    }, `id=eq.${runId}`)

    return new Response(JSON.stringify({ ok: true, run_id: runId }), { status: 200 })
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
