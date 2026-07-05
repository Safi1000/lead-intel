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

// ACTIVE TARGET: Canada (temporary — targeting Canada for the next few days).
// Top Canadian metros by population / med-spa density. Uses "City, PROV, Canada" so Google Places
// resolves the right country.
const TARGET_METROS = [
  'Toronto, ON, Canada',
  'Vancouver, BC, Canada',
  'Montreal, QC, Canada',
  'Calgary, AB, Canada',
  'Edmonton, AB, Canada',
  'Ottawa, ON, Canada',
  'Mississauga, ON, Canada',
  'Winnipeg, MB, Canada',
  'Hamilton, ON, Canada',
  'Quebec City, QC, Canada',
  'Victoria, BC, Canada',
  'Halifax, NS, Canada',
  'Kitchener, ON, Canada',
  'London, ON, Canada',
  'Surrey, BC, Canada',
  'Burnaby, BC, Canada',
  'Markham, ON, Canada',
  'Vaughan, ON, Canada',
  'Oakville, ON, Canada',
  'Richmond, BC, Canada',
]

// US metros — commented out while we target Canada. Restore this list (and comment out the Canadian
// one above) to switch back. HI/AK intentionally excluded (non-contiguous).
// const TARGET_METROS = [
//   'New York City, NY', 'Los Angeles, CA', 'Miami, FL', 'Houston, TX', 'Dallas, TX',
//   'Chicago, IL', 'Atlanta, GA', 'Scottsdale, AZ', 'Las Vegas, NV', 'San Diego, CA',
//   'Austin, TX', 'Beverly Hills, CA', 'Nashville, TN', 'Tampa, FL', 'Orlando, FL',
//   'Charlotte, NC', 'Denver, CO', 'Seattle, WA', 'Boston, MA', 'Phoenix, AZ',
// ]

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GOOGLE_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY')!
const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY')!
const PIPELINE_SECRET = Deno.env.get('PIPELINE_SECRET') ?? ''
// DataForSEO review enrichment — optional; the whole feature is skipped when these are unset.
const DFS_LOGIN = Deno.env.get('DATAFORSEO_LOGIN') ?? ''
const DFS_PASSWORD = Deno.env.get('DATAFORSEO_PASSWORD') ?? ''

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
// Search combinations — yield-aware.
// Location pool lives in the search_locations table (falls back to TARGET_METROS). Every searched
// term×location combo records how many NEW places it produced (search_yield via bump_search_yield
// RPC). Selection skips recently-dry combos (paying to re-search an exhausted metro is pure waste),
// explores never-searched combos first, then exploits the highest-yielding known ones.
// ---------------------------------------------------------------------------

const YIELD_COOLDOWN_DAYS = 14 // a dry combo gets retried after this long (new spas open)

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// Minimum places a combo must have been scanned before we trust its qualify-rate (avoid ranking a
// combo #1 off a single lucky hit). Below this, it uses the global-average prior.
const QUALIFY_MIN_SAMPLE = 12

async function buildYieldAwareSearches(): Promise<Array<{ search_term: string; location: string }>> {
  let locations: string[] = TARGET_METROS
  const yieldMap = new Map<string, { last_new: number; last_searched_at: string | null }>()
  const qualMap = new Map<string, { scanned: number; qualified: number }>()
  let globalRate = 0.15 // prior for never/under-sampled combos
  try {
    const locs = await dbSelect<{ location: string }>('search_locations', 'active=is.true&select=location')
    if (locs.length > 0) locations = locs.map((l) => l.location)
    const yields = await dbSelect<{ search_term: string; location: string; last_new: number; last_searched_at: string | null }>(
      'search_yield', 'select=search_term,location,last_new,last_searched_at')
    for (const y of yields) yieldMap.set(`${y.search_term}|${y.location}`, y)
    // #1 qualify-rate: how many of each combo's scans actually became importable leads.
    const quals = await dbSelectAll<{ search_term: string; search_location: string; scanned: number; qualified: number }>(
      'search_combo_quality', 'select=search_term,search_location,scanned,qualified')
    let totScanned = 0, totQual = 0
    for (const q of quals) {
      qualMap.set(`${q.search_term}|${q.search_location}`, { scanned: q.scanned, qualified: q.qualified })
      totScanned += q.scanned; totQual += q.qualified
    }
    if (totScanned > 200) globalRate = totQual / totScanned
  } catch (e) {
    console.error('[search] yield/quality/location load failed, using static pool:', (e as Error).message)
  }

  // Qualify-rate for a combo: its own rate once well-sampled, else the global prior.
  const rateFor = (key: string): number => {
    const q = qualMap.get(key)
    if (!q || q.scanned < QUALIFY_MIN_SAMPLE) return globalRate
    return q.qualified / q.scanned
  }

  const cooldownMs = YIELD_COOLDOWN_DAYS * 24 * 3600 * 1000
  const fresh: Array<{ search_term: string; location: string }> = []      // never searched
  const productive: Array<{ search_term: string; location: string; rate: number; ln: number }> = []
  let skipped = 0
  for (const term of SEARCH_TERMS) {
    for (const location of locations) {
      const key = `${term}|${location}`
      const y = yieldMap.get(key)
      if (!y) { fresh.push({ search_term: term, location }); continue }
      const age = y.last_searched_at ? Date.now() - new Date(y.last_searched_at).getTime() : Infinity
      if (y.last_new === 0 && age < cooldownMs) { skipped++; continue } // recently dry — don't pay to re-search
      if (y.last_new === 0) fresh.push({ search_term: term, location }) // cooldown expired — re-explore
      else productive.push({ search_term: term, location, rate: rateFor(key), ln: y.last_new })
    }
  }
  // EXPLORE fresh ground first — never-searched combos are GUARANTEED to have new places, so they
  // can't waste the chunk on dupes. (A "productive" combo from history may now be fully saturated —
  // e.g. big metros already scanned by a kept batch — which would burn the empty-streak budget and
  // exhaust the run before it ever reaches fresh cities.) Within each tier, rank by qualify-rate so
  // the highest-yielding combos come first. #1's qualify signal steers ordering; exploration guards
  // against dupe-exhaustion.
  productive.sort((a, b) => b.rate - a.rate || b.ln - a.ln)
  const ordered = [
    ...shuffle(fresh),
    ...productive.map(({ search_term, location }) => ({ search_term, location })),
  ]
  const topRate = productive[0] ? `${Math.round(productive[0].rate * 100)}%` : 'n/a'
  console.log(`[search] combos: ${ordered.length} usable (${productive.length} productive [top qualify ${topRate}], ${fresh.length} fresh), ${skipped} dry-skipped, globalRate ${Math.round(globalRate * 100)}%`)
  return ordered
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
// Max NEW (deduped) leads to enrich per invocation. Deliberately SMALL: Supabase edge functions
// have a cumulative CPU-time limit (not just wall-clock), and each lead does heavy HTML regex.
// ~56 leads/chunk (with concurrency) blew the limit → 546 WORKER_LIMIT kills. ~12-15 is safe.
// Concurrency still makes each small chunk fast, so we just run more short chunks.
const CHUNK_CANDIDATE_CAP = 15

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

// PostgREST caps any single select at 1000 rows — a 1792-lead run silently reported stats/XLSX
// for only the first 1000 (run showed 153 imported when 304 were). Page through everything.
async function dbSelectAll<T = Record<string, unknown>>(table: string, qs: string): Promise<T[]> {
  const pageSize = 1000
  const out: T[] = []
  for (let from = 0; ; from += pageSize) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
      headers: svcHeaders({ 'Range-Unit': 'items', Range: `${from}-${from + pageSize - 1}` }),
    })
    if (!res.ok) throw new Error(`dbSelectAll ${table}: ${res.status} ${await res.text()}`)
    const page = (await res.json()) as T[]
    out.push(...page)
    if (page.length < pageSize) break
  }
  return out
}

// Cumulative run totals, computed from the DB at finalize (chunk counters are per-invocation).
async function computeRunTotals(runId: string): Promise<Record<string, number>> {
  const rows = await dbSelectAll<{ website_status: string | null; crm_lead_id: string | null; email: string | null; website: string | null }>(
    'sourced_places', `pipeline_run_id=eq.${runId}&select=website_status,crm_lead_id,email,website&order=place_id`,
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
  const rows = await dbSelectAll<Record<string, unknown>>(
    'sourced_places',
    `pipeline_run_id=eq.${runId}&order=created_at,place_id&select=place_id,name,address,phone,website,website_status,status_reason,is_correct_niche,site_issue_note,email,email_source,email_confidence,email_mx_ok,seo_score,tech_stack,rating,quality_score,low_fit,pain_points,personalization_notes,search_term,search_location,error`,
  )
  return rows.map((r) => ({
    place_id: r.place_id, name: r.name, address: r.address, phone: r.phone ?? '', website: r.website ?? '',
    website_status: r.website_status ?? '', status_reason: r.status_reason ?? '', is_correct_niche: r.is_correct_niche ?? '',
    site_issue_note: r.site_issue_note ?? '', email: r.email ?? '', email_source: r.email_source ?? '', email_confidence: r.email_confidence ?? '',
    email_verified: r.email_mx_ok === true ? 'yes' : r.email_mx_ok === false ? 'NO — domain has no mail records' : '',
    seo_score: r.seo_score ?? '', tech_stack: r.tech_stack ?? '',
    rating: r.rating ?? '', quality_score: r.quality_score ?? '', low_fit: r.low_fit ?? '', pain_points: r.pain_points ?? '',
    personalization_notes: r.personalization_notes ?? '', search_query: r.search_term ?? '', search_location: r.search_location ?? '', error: r.error ?? '',
  }))
}

// ---------------------------------------------------------------------------
// Google Places helpers
// ---------------------------------------------------------------------------

// Text Search (New) returns ALL enrichment fields we need in one request. Requesting them here —
// instead of a per-place Place Details call — is ~12x cheaper: Text Search bills per request
// (~20 places), Place Details bills per place. See placesTextSearch field mask.
interface RawPlace {
  id: string
  displayName?: { text: string }
  formattedAddress?: string
  primaryType?: string
  types?: string[]
  websiteUri?: string
  internationalPhoneNumber?: string
  rating?: number
  userRatingCount?: number
  businessStatus?: string
  reviews?: Array<{ text?: { text?: string }; rating?: number }>
}

interface PlaceDetails {
  id: string
  name: string
  phone: string | null
  website: string | null
  rating: number | null
  businessStatus: string | null // OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY
  reviews: Array<{ text: string; rating: number }>
}

// Build the enrichment record from the search result itself — no extra Place Details call needed.
function detailsFromRawPlace(p: RawPlace): PlaceDetails {
  return {
    id: p.id,
    name: p.displayName?.text ?? '',
    phone: p.internationalPhoneNumber ?? null,
    website: p.websiteUri ?? null,
    rating: p.rating ?? null,
    businessStatus: p.businessStatus ?? null,
    reviews: (p.reviews ?? []).map((r) => ({ text: r.text?.text ?? '', rating: r.rating ?? 0 })),
  }
}

// Google business types that are DEFINITELY not our niche — skipped BEFORE Place Details + website
// scan + OpenAI, saving both API costs. Conservative on purpose: anything ambiguous (spa,
// beauty_salon, doctor, massage) still goes to the AI, which sees the type as evidence.
const EXCLUDED_PLACE_TYPES = new Set([
  'gym', 'fitness_center', 'yoga_studio', 'pilates_studio',
  'dentist', 'dental_clinic', 'dental_lab', 'orthodontist',
  'hair_salon', 'barber_shop', 'nail_salon', 'tattoo_parlor',
  'chiropractor', 'physiotherapist', 'physical_therapy_clinic',
  'tanning_studio', 'veterinary_care', 'pet_groomer', 'florist', 'pharmacy',
])

// Booking labels that are INFERRED (form/link/CTA heuristics) rather than a named platform match.
// Rules-skip requires a NAMED platform — inferred booking still goes to the AI for judgment.
const INFERRED_BOOKING_LABELS = new Set([
  'Embedded form/scheduler', 'Booking link', 'Contact/appointment page', 'On-page form',
  'Contact/booking CTA', 'Embedded/custom booking', 'Booking/contact found on rendered page',
])

// #2 cheap pre-gates — from FREE search-response data (rating, review count, businessStatus).
// Skip near-certain rejects BEFORE the expensive website scan + OpenAI, so each chunk covers more
// real candidates. Conservative on purpose (recall matters): thresholds catch only clear rejects.
const MIN_RATING = 3.5        // below this a spa reads as struggling; rubric rejects as "unproven"
const MIN_REVIEW_COUNT = 3    // 0-2 reviews = brand-new/dead listing, can't assess as a real business

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
      // Enterprise+Atmosphere fields (websiteUri/phone/rating/reviews) fold the old per-place Place
      // Details call into this one request — ~12x cheaper per place. Bills the request at the
      // highest tier of any field requested, but each request covers ~20 places.
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.primaryType,places.types,places.websiteUri,places.internationalPhoneNumber,places.rating,places.userRatingCount,places.businessStatus,places.reviews,nextPageToken',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Places searchText: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return { places: data.places ?? [], nextPageToken: data.nextPageToken }
}

// ---------------------------------------------------------------------------
// DataForSEO review enrichment (two-pass, async).
// For every IMPORTED lead we post two review tasks — 20 NEWEST + 20 lowest rated — so the AI can
// later rebuild pain_points from a current + friction-weighted sample instead of Google's 5
// relevance-picked reviews.
// DataForSEO pings our reviews-finalize edge function when each task completes (~≤45 min).
// Cost: ~$0.0045/lead. Skipped entirely when DATAFORSEO_* secrets are unset.
// ---------------------------------------------------------------------------

// When a lead's "website" is actually a third-party booking/marketplace/link host (not the clinic's
// own domain), an ads query returns the PLATFORM's ads, not the clinic's — a false positive.
// Skip ads detection for these. Matches the bare domain OR any subdomain of it.
const BOOKING_PLATFORM_DOMAINS = [
  'fresha.com', 'booksy.com', 'booksy.net', 'vagaro.com', 'square.site', 'squareup.com',
  'glossgenius.com', 'styleseat.com', 'schedulicity.com', 'mindbodyonline.com', 'setmore.com',
  'janeapp.com', 'calendly.com', 'acuityscheduling.com', 'simplybook.me', 'simplybook.it',
  'noterro.com', 'timetap.com', 'linktr.ee', 'instagram.com', 'facebook.com', 'linktree.com', 'carrd.co',
]
function isBookingPlatformDomain(domain: string): boolean {
  const d = domain.replace(/^www\./, '').toLowerCase()
  return BOOKING_PLATFORM_DOMAINS.some((p) => d === p || d.endsWith('.' + p))
}

// Google Ads detection via DataForSEO Ads Transparency (reads Google's official public ad registry
// — catches even small local advertisers). "Running ads + weak site" = our strongest hook.
// Standard queue (task_post ~$0.0006/lead, ~5 min) — reviews-finalize retrieves the result later
// (by which time reviews, always slower, are done too). Returns the task_id or null; non-fatal.
async function postAdsTask(domain: string, isCanada: boolean): Promise<string | null> {
  if (!DFS_LOGIN || !DFS_PASSWORD || !domain) return null
  try {
    const res = await fetch('https://api.dataforseo.com/v3/serp/google/ads_advertisers/task_post', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`${DFS_LOGIN}:${DFS_PASSWORD}`), 'Content-Type': 'application/json' },
      body: JSON.stringify([{ keyword: domain, location_code: isCanada ? 2124 : 2840, language_code: 'en', tag: domain }]),
    })
    if (!res.ok) { console.error(`[ads] task_post HTTP ${res.status}`); return null }
    const data = await res.json()
    const t = data?.tasks?.[0]
    return (t?.id && (t.status_code === 20100 || t.status_code === 20000)) ? t.id : null
  } catch (e) {
    console.error(`[ads] task_post failed for ${domain}:`, (e as Error).message)
    return null
  }
}

async function enqueueReviewTasks(placeId: string, orgId: string, isCanada: boolean): Promise<void> {
  if (!DFS_LOGIN || !DFS_PASSWORD) return
  try {
    const pingback = `${SUPABASE_URL}/functions/v1/reviews-finalize?id=$id&tag=$tag&secret=${encodeURIComponent(PIPELINE_SECRET)}`
    const base = {
      place_id: placeId,
      depth: 20,
      language_code: 'en',
      location_code: isCanada ? 2124 : 2840, // Canada / United States
      tag: placeId,
      pingback_url: pingback,
    }
    const res = await fetch('https://api.dataforseo.com/v3/business_data/google/reviews/task_post', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`${DFS_LOGIN}:${DFS_PASSWORD}`),
        'Content-Type': 'application/json',
      },
      // newest = current operational reality (still mostly positive for 4.8★+ spas, so the praise
      // theme survives); lowest_rating = guaranteed friction/dirt. No compound sort exists in the API.
      body: JSON.stringify([
        { ...base, sort_by: 'newest' },
        { ...base, sort_by: 'lowest_rating' },
      ]),
    })
    if (!res.ok) { console.error(`[reviews] task_post HTTP ${res.status}`); return }
    const data = await res.json()
    const tasks: Array<{ id?: string; status_code?: number; data?: { sort_by?: string } }> = data?.tasks ?? []
    for (const t of tasks) {
      if (t.id && (t.status_code === 20100 || t.status_code === 20000)) {
        await dbInsert('review_tasks', {
          task_id: t.id, place_id: placeId, org_id: orgId,
          sort: t.data?.sort_by ?? null, status: 'pending',
        }).catch((e) => console.error('[reviews] task row insert failed:', (e as Error).message))
      } else {
        console.error(`[reviews] task rejected for ${placeId}: ${t.status_code}`)
      }
    }
  } catch (e) {
    console.error(`[reviews] enqueue failed for ${placeId}:`, (e as Error).message)
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
        'x-upsert': 'true', // allow regeneration to overwrite the original export at the same path
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

  let body: { run_id: string; org_id: string; dry_run?: boolean; max_places?: number; target_total?: number; qualified_target?: number; batch_id?: string; batch_id_no_website?: string; batch_name?: string; chunk_index?: number }
  try { body = await req.json() } catch {
    return new Response(JSON.stringify({ error: 'invalid body' }), { status: 400 })
  }

  const { run_id: runId, org_id: orgId, dry_run: dryRun = false, max_places: maxPlacesOverride,
          target_total: targetTotal, qualified_target: qualifiedTarget,
          batch_id: incomingBatchId, batch_id_no_website: incomingBatchIdNoWebsite,
          batch_name: batchName, chunk_index: chunkIndex = 0 } = body
  if (!runId || !orgId) {
    return new Response(JSON.stringify({ error: 'run_id and org_id are required' }), { status: 400 })
  }

  // Maintenance action: rebuild a completed run's XLSX from CURRENT DB state — picks up review
  // enrichment / ads verdicts / corrections that landed after finalize, and (via dbSelectAll)
  // includes ALL rows for >1000-place runs. Overwrites the same storage path, refreshes totals.
  if ((body as { action?: string }).action === 'regenerate_xlsx') {
    const rows = await fetchRunXlsxRows(runId)
    if (rows.length === 0) return new Response(JSON.stringify({ ok: false, error: 'no rows for run' }), { status: 200 })
    const path = await buildAndUploadXlsx(orgId, runId, rows)
    const totals = await computeRunTotals(runId)
    await dbUpdate('pipeline_runs', {
      ...(path ? { xlsx_path: path } : {}), ...totals, xlsx_regenerated_at: new Date().toISOString(),
    }, `id=eq.${runId}`)
    console.log(`[pipeline-run] regenerated XLSX for ${runId}: ${rows.length} rows`)
    return new Response(JSON.stringify({ ok: true, regenerated: !!path, rows: rows.length }), { status: 200 })
  }

  // Chaining job when a target is set. Two modes:
  //   qualified_target → keep going until N IMPORTABLE leads are collected (the "Qualified Leads" input)
  //   target_total     → run until N leads are PROCESSED (legacy large-batch)
  const qualifiedMode = qualifiedTarget != null
  const chaining = qualifiedMode || targetTotal != null
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

    // Cumulative progress read at chunk start (chaining jobs span many invocations).
    let processedSoFar = 0, importedSoFar = 0, emptyStreak = 0
    if (chaining) {
      const runRows = await dbSelect<{ processed_total: number; total_imported: number; empty_streak: number }>(
        'pipeline_runs', `id=eq.${runId}&select=processed_total,total_imported,empty_streak`)
      processedSoFar = Number(runRows[0]?.processed_total ?? 0)
      importedSoFar = Number(runRows[0]?.total_imported ?? 0)
      emptyStreak = Number(runRows[0]?.empty_streak ?? 0)
    }
    // Per-chunk candidate cap. target_total mode also respects remaining toward its processed target.
    const remaining = targetTotal != null ? Math.max(0, targetTotal - processedSoFar) : CHUNK_CANDIDATE_CAP
    const maxPlaces = chaining ? Math.min(remaining, CHUNK_CANDIDATE_CAP) : cfgMax

    // -------------------------------------------------------------------------
    // Phase 1: SEARCH — iterate shuffled combos until maxPlaces reached
    // -------------------------------------------------------------------------
    type RawResult = RawPlace & { _search_term: string; _location: string; _address: string; _name: string }
    const allResults: RawResult[] = []
    const searches = await buildYieldAwareSearches()
    const searchedCombos: Array<{ search_term: string; location: string; raw: number }> = []

    for (const search of searches) {
      if (allResults.length >= maxPlaces) break
      try {
        let raw = 0
        let pageToken: string | undefined
        do {
          const { places, nextPageToken } = await placesTextSearch(search.search_term, search.location, pageToken)
          for (const p of places) {
            raw++
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
        searchedCombos.push({ ...search, raw })
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

    // Record yield for every combo actually searched this chunk (0-new records are the whole
    // point — they mark the combo as dry so future chunks stop paying to re-search it).
    if (searchedCombos.length > 0) {
      const newByCombo = new Map<string, number>()
      for (const r of newResults) {
        const k = `${r._search_term}|${r._location}`
        newByCombo.set(k, (newByCombo.get(k) ?? 0) + 1)
      }
      await Promise.all(searchedCombos.map((c) => {
        const nw = newByCombo.get(`${c.search_term}|${c.location}`) ?? 0
        // A zero from a cut-off search (few raw results sampled) isn't proof the combo is dry —
        // only record zeros when we actually saw a meaningful sample. Positives always count.
        if (nw === 0 && c.raw < 8) return Promise.resolve()
        return fetch(`${SUPABASE_URL}/rest/v1/rpc/bump_search_yield`, {
          method: 'POST', headers: svcHeaders(),
          body: JSON.stringify({ p_term: c.search_term, p_location: c.location, p_new: nw }),
        }).catch((e) => console.error('[search] yield bump failed:', (e as Error).message))
      }))
    }
    // Legacy runs report totals per run; chaining jobs report cumulative progress via processed_total.
    if (!chaining) await dbUpdate('pipeline_runs', { total_searched: totalSearched, total_new: totalNew }, `id=eq.${runId}`)

    // -------------------------------------------------------------------------
    // Prepare CRM batch. Chaining jobs reuse ONE named batch across all chunks (created by the
    // trigger and passed in as batch_id); legacy runs create their own.
    // -------------------------------------------------------------------------
    let batchId: string | null = incomingBatchId ?? null
    // The no-website batch is created by the trigger (qualified-lead jobs). Legacy runs leave it null.
    const batchIdNoWebsite: string | null = incomingBatchIdNoWebsite ?? null
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
    let stopped = false
    let processedThisChunk = 0

    // Process leads in bounded-concurrency batches. Per-lead work is mostly waiting on the website
    // fetch + OpenAI, so running LEAD_CONCURRENCY at once overlaps those waits (~6x faster) while
    // staying well within Google Places / OpenAI rate limits. Shared counters/arrays are safe to
    // mutate from the callbacks (JS is single-threaded; mutations happen between awaits).
    const LEAD_CONCURRENCY = 3
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

      // Type pre-filter — Google already classified this business. If its primary type is
      // definitely out of niche (gym, dentist, nail salon...), record it for dedup and skip the
      // expensive Place Details + website scan + OpenAI calls entirely.
      const placeType = result.primaryType ?? result.types?.[0] ?? ''
      if (placeType && EXCLUDED_PLACE_TYPES.has(placeType)) {
        try {
          await dbInsert('sourced_places', {
            place_id: placeId, org_id: orgId, pipeline_run_id: runId,
            search_term: result._search_term, search_location: result._location,
            name: result._name, address: result._address,
            is_correct_niche: false, quality_score: 1, low_fit: true,
            status_reason: `Excluded by Google business type: ${placeType}`,
          })
        } catch (e) { console.error(`[${placeId}] type-filter insert failed:`, (e as Error).message) }
        console.log(`[${placeId}] pre-filtered (type: ${placeType})`)
        return
      }

      // Phase 3: Enrichment — now comes FREE with the search result (no per-place Place Details
      // call). website/phone/rating/reviews/businessStatus were already returned by placesTextSearch.
      details = detailsFromRawPlace(result)
      totalEnriched++

      // #2 pre-gates — record for dedup and skip BEFORE the website scan + OpenAI. Uses only the
      // free search data (rating, review count, businessStatus). Conservative to protect recall.
      const preGateReason =
        details.businessStatus === 'CLOSED_PERMANENTLY' ? 'Permanently closed on Google Maps' :
        details.businessStatus === 'CLOSED_TEMPORARILY' ? 'Temporarily closed on Google Maps' :
        (result.userRatingCount != null && result.userRatingCount < MIN_REVIEW_COUNT)
          ? `Only ${result.userRatingCount} Google reviews — not an established business` :
        (details.rating != null && details.rating < MIN_RATING)
          ? `Google rating ${details.rating} below ${MIN_RATING} — unproven business` :
        null
      if (preGateReason) {
        try {
          await dbInsert('sourced_places', {
            place_id: placeId, org_id: orgId, pipeline_run_id: runId,
            search_term: result._search_term, search_location: result._location,
            name: details.name, address: result._address, phone: details.phone,
            website: details.website, rating: details.rating,
            is_correct_niche: false, quality_score: 1, low_fit: true, status_reason: preGateReason,
          })
        } catch (e) { console.error(`[${placeId}] pre-gate insert failed:`, (e as Error).message) }
        console.log(`[${placeId}] pre-gated: ${preGateReason}`)
        return
      }

      // A "website" that's actually a 3rd-party booking/marketplace/social page (Square, Fresha,
      // Vagaro, a Facebook page…) means the clinic has NO real site of their own. Treat it as a
      // no-website lead: route to the build-from-scratch batch, and make the platform the pitch.
      let platformHost: string | null = null
      if (details?.website) {
        try {
          const dom = new URL(details.website).hostname.replace(/^www\./, '').toLowerCase()
          if (isBookingPlatformDomain(dom)) {
            platformHost = BOOKING_PLATFORM_DOMAINS.find((p) => dom === p || dom.endsWith('.' + p)) ?? dom
          }
        } catch { /* unparseable */ }
      }
      const realWebsite = !!details?.website && !platformHost // their own site (not a platform link)
      const hasWebsite = realWebsite
      if (!hasWebsite) totalNoWebsite++

      // Insert into sourced_places now (marks the place as seen even if later steps fail).
      // No-website leads are KEPT and scored too — they go to the "build from scratch" batch.
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
          website: details?.website ?? null,
          rating: details?.rating ?? null,
          error: rowError,
        })
      } catch (e) {
        console.error(`[${placeId}] sourced_places insert failed:`, (e as Error).message)
        return
      }

      // Phase 4: Website analysis — only when there's a website.
      let emailResult = { email: null as string | null, emailSource: 'none' as string, emailConfidence: 'none' as string }
      let websiteResult = null
      if (hasWebsite) {
        try {
          websiteResult = await analyzeWebsite(details!.website!)
          if (websiteResult.email) {
            emailResult = { email: websiteResult.email, emailSource: websiteResult.emailSource, emailConfidence: websiteResult.emailConfidence }
            totalEmailed++
          }
        } catch (e) {
          console.error(`[${placeId}] website analysis failed:`, (e as Error).message)
        }
      }

      // Rules-skip: when the scraper is CERTAIN the site is good — a NAMED booking platform,
      // mobile viewport, zero detected issues, no chain signals — the lead can never be imported
      // (gate requires 'weak'), so scoring it with the AI is pure wasted spend (~75% of scanned
      // leads in saturated metros are good sites). Anything uncertain still goes to the AI.
      // SOFT issues (pitch angles, not real weaknesses — the AI classifies these sites 'good' anyway)
      // don't block the skip. Any HARD issue (no email, slow, old copyright, SSL, SEO, no-contact,
      // free subdomain, etc.) still routes the lead to the AI. Verified vs Playwright 2026-07-04.
      const softIssue = (i: string) => i.startsWith('No Instagram or Facebook') || i.startsWith('Built on ')
      const certainGood = !!(
        hasWebsite && websiteResult && websiteResult.reachable
        && websiteResult.hasBookingWidget && websiteResult.bookingPlatform
        && !INFERRED_BOOKING_LABELS.has(websiteResult.bookingPlatform)
        && websiteResult.hasMobileViewport
        && websiteResult.detectedIssues.every(softIssue)
        && websiteResult.chainSignals.length === 0
      )
      if (certainGood && details) {
        aiScore = {
          is_correct_niche: true, // irrelevant to the gate for 'good' sites; kept truthy for consistency
          website_status: 'good',
          status_reason: `Modern site: ${websiteResult!.bookingPlatform} online booking, mobile-friendly, no issues detected (auto-classified — AI skipped).`,
          site_issue_note: 'N/A',
          quality_score: 2,
          low_fit: true,
          confidence: 'high',
          pain_points: 'not analyzed — site is already modern, nothing to sell',
          personalization_notes: '',
        }
        aiRaw = { rules_skip: true }
      }

      // Phase 5: AI scoring — also scores no-website leads (determines niche + reachability).
      if (details && !certainGood) {
        try {
          const placeForAi: PlaceForScoring = {
            name: details.name,
            address: result._address,
            phone: details.phone,
            website: hasWebsite ? details.website : null, // platform-only → score as no-website
            rating: details.rating,
            businessType: placeType || null,
            reviews: details.reviews,
            email: emailResult.email,
            websiteSignals: websiteResult,
          }
          const { score, raw } = await scorePlace(placeForAi, qualityThreshold, model, OPENAI_KEY)
          aiScore = score
          aiRaw = raw
          // Pin website_status to reality regardless of the model's guess: no real website → 'none';
          // has a real website but model says 'none' → coerce to 'unknown' (prevents misrouting).
          if (aiScore) {
            if (!hasWebsite) aiScore.website_status = 'none'
            else if (aiScore.website_status === 'none') aiScore.website_status = 'unknown'
          }
          // Platform-only lead: make the fake-website the lead pain point (it's the pitch), so the
          // setter knows before calling. Prepends to whatever review-based angle the AI produced.
          if (platformHost && aiScore) {
            const fakeSiteNote = `They have no real website of their own — their only web presence is a ${platformHost} booking page (a rented 3rd-party link, easily lost and not truly theirs).`
            aiScore.site_issue_note = fakeSiteNote
            aiScore.pain_points = aiScore.pain_points && !/insufficient/i.test(aiScore.pain_points)
              ? `${fakeSiteNote}\n${aiScore.pain_points}`
              : fakeSiteNote
            aiScore.status_reason = `No real website — only a ${platformHost} booking page (3rd-party).`
          }
        } catch (e) {
          console.error(`[${placeId}] AI scoring failed:`, (e as Error).message)
          rowError = (rowError ? rowError + '; ' : '') + `AI failed: ${(e as Error).message}`
        }
      }

      // Update sourced_places with all enriched data
      try {
        await dbUpdate(
          'sourced_places',
          {
            email: emailResult.email,
            email_source: emailResult.emailSource,
            email_confidence: emailResult.emailConfidence,
            seo_score: websiteResult?.seoScore ?? null,
            tech_stack: websiteResult?.techStack ?? null,
            email_mx_ok: websiteResult?.emailMxOk ?? null,
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

      // Phase 6: Import decision (dual-batch, keyed by place_id).
      //   WEBSITE batch    → correct niche + WEAK site + passes quality + reachable (redesign pitch)
      //   NO-WEBSITE batch → correct niche + reachable (build-from-scratch pitch)
      const reachable = !!(emailResult.email || (details?.phone && String(details.phone).trim() !== ''))
      let importBatchId: string | null = null
      if (aiScore && aiScore.is_correct_niche && reachable) {
        if (aiScore.website_status === 'weak' && !aiScore.low_fit) importBatchId = batchId
        else if (aiScore.website_status === 'none') importBatchId = batchIdNoWebsite
      }

      // Website de-dup: the same clinic often has multiple Google listings (different locations) on
      // ONE website. If that website is already imported for this org, skip this duplicate.
      if (importBatchId && importBatchId === batchId && details?.website) {
        try {
          const dom = new URL(details.website).hostname.replace(/^www\./, '').toLowerCase()
          if (dom) {
            const dupes = await dbSelect<{ place_id: string }>(
              'sourced_places',
              `website=ilike.*${dom}*&crm_lead_id=not.is.null&place_id=neq.${placeId}&select=place_id&limit=1`,
            )
            if (dupes.length > 0) { importBatchId = null; console.log(`[${placeId}] duplicate website (${dom}) already imported — skipping`) }
          }
        } catch { /* unparseable URL — proceed with import */ }
      }

      if (!dryRun && importBatchId && details) {
        const isCanada = /Canada/i.test(result._location) || /Canada/i.test(result._address)
        // Google Ads detection — only for WEBSITE-batch imports (weak site + real domain), where
        // "paying for ads → weak site" is the killer hook. Standard queue: post the task now, and
        // reviews-finalize retrieves the verdict + weaves it into pain_points later.
        let adsTaskId: string | null = null
        let adsDomain = ''
        let adsIsPlatform = false
        if (importBatchId === batchId && details.website) {
          try { adsDomain = new URL(details.website).hostname.replace(/^www\./, '').toLowerCase() } catch { /* skip */ }
          if (adsDomain && isBookingPlatformDomain(adsDomain)) adsIsPlatform = true // their "site" is a platform link — skip
          else if (adsDomain) adsTaskId = await postAdsTask(adsDomain, isCanada)
        }
        const adsLabel = adsTaskId ? 'Checking…' : adsIsPlatform ? 'N/A (booking-platform link)' : 'No / not detected'
        // Import immediately (per-lead) so a chunk killed mid-way never strands qualified leads.
        try {
          const inserted = await dbInsert<{ id: string }>('leads', {
            org_id: orgId,
            batch_id: importBatchId,
            template_id: null,
            template_name: 'Google Maps Pipeline',
            display_name: details.name,
            status: 'new',
            source_type: 'google_maps',
            source_meta: { search_query: result._search_term, search_location: result._location, website_status: aiScore!.website_status },
            data: {
              'Business Name': details.name,
              'Address': result._address,
              'Phone': details.phone ?? '',
              'Website': details.website ?? '',
              'Email': emailResult.email ?? '',
              'Email Verified': websiteResult?.emailMxOk === true ? 'Yes (MX)' : websiteResult?.emailMxOk === false ? 'No — domain cannot receive mail' : '',
              'SEO Score': websiteResult?.seoScore != null ? `${websiteResult.seoScore}/100` : '',
              'Tech Stack': websiteResult?.techStack ?? '',
              'Rating': details.rating != null ? String(details.rating) : '',
              'Website Status': aiScore?.website_status ?? '',
              'Why This Status': aiScore?.status_reason ?? '',
              'Site Issue Note': aiScore?.site_issue_note ?? '',
              'Pain Points': aiScore?.pain_points ?? '',
              'Running Google Ads': adsLabel,
              'Quality Score': aiScore?.quality_score != null ? String(aiScore.quality_score) : '',
              'Personalization Notes': aiScore?.personalization_notes ?? '',
              'Source': 'Google Maps Pipeline',
              'Search Query': result._search_term,
              'Search Location': result._location,
            },
            created_by: 'pipeline',
          })
          const leadId = inserted[0]?.id
          if (leadId) {
            await dbUpdate('sourced_places', {
              crm_lead_id: leadId, imported_at: new Date().toISOString(),
              ads_task_id: adsTaskId,
            }, `place_id=eq.${placeId}`)
            totalImported++
            // Two-pass review enrichment: only for leads worth selling to (i.e., the ones we import).
            await enqueueReviewTasks(placeId, orgId, isCanada)
          }
        } catch (e) {
          console.error(`[${placeId}] import failed:`, (e as Error).message)
        }
      } else if (dryRun) {
        const verdict = !aiScore ? 'no AI score'
          : !aiScore.is_correct_niche ? 'wrong niche'
          : !reachable ? 'not reachable'
          : aiScore.website_status === 'none' ? 'WOULD IMPORT → no-website batch'
          : (aiScore.website_status === 'weak' && !aiScore.low_fit) ? 'WOULD IMPORT → website batch'
          : `skip (${aiScore.website_status}${aiScore.low_fit ? ' low_fit' : ''})`
        console.log(`[dry-run] ${details?.name} | ${verdict}`)
      }

      xlsxRows.push({
        place_id: placeId,
        name: details?.name ?? result._name,
        address: result._address,
        phone: details?.phone ?? '',
        website: details?.website ?? '',
        website_status: aiScore?.website_status ?? '',
        status_reason: aiScore?.status_reason ?? '',
        is_correct_niche: aiScore?.is_correct_niche ?? '',
        site_issue_note: aiScore?.site_issue_note ?? '',
        email: emailResult.email ?? '',
        email_source: emailResult.emailSource,
        email_confidence: emailResult.emailConfidence,
        rating: details?.rating ?? '',
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

    // Imports now happen per-lead (above). Legacy runs update the batch count here; chaining jobs
    // set the cumulative count at finalize.
    if (!dryRun && batchId && !chaining) await dbUpdate('batches', { imported_count: totalImported }, `id=eq.${batchId}`)

    // -------------------------------------------------------------------------
    // Chain the next chunk, or finalize.
    // -------------------------------------------------------------------------
    const newProcessedTotal = processedSoFar + processedThisChunk
    const newImportedTotal = importedSoFar + totalImported
    const foundNew = newResults.length > 0
    const newEmptyStreak = foundNew ? 0 : emptyStreak + 1
    // Re-check stop right before deciding to chain — a stop requested during the last batch or the
    // import/finalize step must still prevent the next chunk from spawning.
    if (chaining && !stopped) {
      const sr = await dbSelect<{ stop_requested: boolean }>('pipeline_runs', `id=eq.${runId}&select=stop_requested`)
      if (sr[0]?.stop_requested) { stopped = true; console.log('[pipeline-run] stop detected before chaining — halting') }
    }

    // Terminate when the mode's target is met, or on safety limits (metros exhausted / hard ceiling).
    //   qualified_target → stop once we've IMPORTED that many worthy leads
    //   target_total     → stop once we've PROCESSED that many leads
    const targetMet = qualifiedMode
      ? newImportedTotal >= (qualifiedTarget as number)
      : (targetTotal != null ? newProcessedTotal >= targetTotal : false)
    // Give up only after 8 consecutive empty search passes (metros exhausted) or a hard 10k ceiling.
    const exhausted = chaining && (newEmptyStreak >= 8 || newProcessedTotal >= 10000)
    const shouldChain = chaining && !stopped && !targetMet && !exhausted

    if (shouldChain) {
      await dbUpdate('pipeline_runs', {
        status: 'running',
        processed_total: newProcessedTotal,
        total_imported: newImportedTotal,
        empty_streak: newEmptyStreak,
        chunk_index: chunkIndex + 1,
        batch_id: batchId,
        batch_id_no_website: batchIdNoWebsite,
        last_progress_at: new Date().toISOString(), // heartbeat for the stall watchdog
      }, `id=eq.${runId}`)
      await chainNextChunk({
        run_id: runId, org_id: orgId, dry_run: dryRun,
        target_total: targetTotal, qualified_target: qualifiedTarget,
        batch_id: batchId, batch_id_no_website: batchIdNoWebsite, batch_name: batchName, chunk_index: chunkIndex + 1,
      })
      console.log(`[pipeline-run] chunk ${chunkIndex}: scanned ${newProcessedTotal}, imported ${newImportedTotal}${qualifiedMode ? '/' + qualifiedTarget : ''} → chained`)
      return new Response(JSON.stringify({ ok: true, run_id: runId, chunk: chunkIndex, processed: newProcessedTotal, imported: newImportedTotal, chaining: true }), { status: 200 })
    }

    // FINALIZE — legacy single run, or the last chunk of a chaining job.
    const finalTotals = chaining
      ? await computeRunTotals(runId)
      : { total_searched: totalSearched, total_new: totalNew, total_enriched: totalEnriched, total_emailed: totalEmailed, total_imported: totalImported, total_no_website: totalNoWebsite }

    // Per-batch import counts (website vs no-website).
    if (batchId) {
      const c = (await dbSelect<{ id: string }>('leads', `batch_id=eq.${batchId}&select=id`)).length
      await dbUpdate('batches', { imported_count: c, total_rows: c }, `id=eq.${batchId}`)
    }
    if (batchIdNoWebsite) {
      const c = (await dbSelect<{ id: string }>('leads', `batch_id=eq.${batchIdNoWebsite}&select=id`)).length
      await dbUpdate('batches', { imported_count: c, total_rows: c }, `id=eq.${batchIdNoWebsite}`)
    }

    // XLSX audit log (upload even on partial/stopped runs). Chaining rebuilds from the DB.
    const exportRows = chaining ? await fetchRunXlsxRows(runId) : xlsxRows
    let xlsxPath: string | null = null
    if (exportRows.length > 0) xlsxPath = await buildAndUploadXlsx(orgId, runId, exportRows)

    await dbUpdate('pipeline_runs', {
      status: stopped ? 'stopped' : 'completed',
      completed_at: new Date().toISOString(),
      processed_total: newProcessedTotal,
      empty_streak: newEmptyStreak,
      chunk_index: chunkIndex + 1,
      batch_id: batchId,
      batch_id_no_website: batchIdNoWebsite,
      ...finalTotals,
      xlsx_path: xlsxPath,
    }, `id=eq.${runId}`)

    return new Response(JSON.stringify({ ok: true, run_id: runId, processed: newProcessedTotal, imported: finalTotals.total_imported, chaining }), { status: 200 })

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
