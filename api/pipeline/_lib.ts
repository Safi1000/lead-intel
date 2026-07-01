/**
 * Shared helpers for the pipeline serverless endpoints.
 * Mirrors the pattern in api/bookings/_lib.ts — raw Node req/res,
 * no framework dependency, PostgREST for Supabase access.
 *
 * Auth: accepts EITHER a PIPELINE_SECRET token (for external/routine callers)
 * OR a valid Supabase JWT (for the frontend — verified via Supabase Auth).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const SUPABASE_URL = process.env.SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const PIPELINE_SECRET = process.env.PIPELINE_SECRET || ''

// ---------------------------------------------------------------------------
// HTTP helpers (identical pattern to bookings/_lib.ts)
// ---------------------------------------------------------------------------

export function sendJson(res: any, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  try {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(payload)
  } catch {
    if (typeof res.status === 'function') res.status(status).json(body)
  }
}

export function readQuery(req: any, key: string): string {
  if (req?.query && req.query[key] != null) return String(req.query[key])
  try {
    return new URL(req.url, 'http://localhost').searchParams.get(key) ?? ''
  } catch {
    return ''
  }
}

export function readBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    if (req.body !== undefined) { resolve(req.body); return }
    let raw = ''
    req.on('data', (c: any) => { raw += c })
    req.on('end', () => {
      try { resolve(JSON.parse(raw)) } catch { resolve({}) }
    })
    req.on('error', () => resolve({}))
  })
}

/**
 * Auth check. Returns true (and sends 401) if the request is not authorized.
 * Accepts either:
 *   - ?token=PIPELINE_SECRET  or  Authorization: Bearer PIPELINE_SECRET  (external callers)
 *   - Authorization: Bearer <supabase-jwt>  (frontend — verified via Supabase Auth)
 */
export async function requireAuth(req: any, res: any): Promise<boolean> {
  const fromQuery = readQuery(req, 'token')
  const authHeader: string = req.headers?.authorization ?? ''
  const fromHeader = authHeader.replace(/^Bearer\s+/i, '')
  const token = fromQuery || fromHeader

  if (!token) {
    sendJson(res, 401, { error: { code: 'unauthorized', message: 'Missing token or Authorization header.' } })
    return true
  }

  // 1. Secret token (Claude Code Routine / direct curl)
  if (PIPELINE_SECRET && (token === PIPELINE_SECRET)) return false

  // 2. Supabase JWT (frontend — verify against Supabase Auth API)
  try {
    const key = ANON_KEY || SERVICE_KEY
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
    })
    if (authRes.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const user = await authRes.json() as any
      if (user?.id) return false // valid session
    }
  } catch {
    /* fall through to 401 */
  }

  sendJson(res, 401, { error: { code: 'unauthorized', message: 'Invalid or expired token.' } })
  return true
}

// ---------------------------------------------------------------------------
// Supabase PostgREST admin client (service role, bypasses RLS)
// ---------------------------------------------------------------------------

export interface QueryOptions {
  select?: string
  filters?: string
  order?: string
  limit?: number
  single?: boolean
}

async function pgRest(method: string, table: string, body?: unknown, opts?: QueryOptions): Promise<any> {
  let url = `${SUPABASE_URL}/rest/v1/${table}`
  const params = new URLSearchParams()
  if (opts?.select) params.set('select', opts.select)
  if (opts?.filters) opts.filters.split('&').forEach((f) => { const [k, v] = f.split('='); if (k) params.set(k, v ?? '') })
  if (opts?.order) params.set('order', opts.order)
  if (opts?.limit) params.set('limit', String(opts.limit))
  const qs = params.toString()
  if (qs) url += '?' + qs

  const headers: Record<string, string> = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  }
  if (opts?.single) headers['Accept'] = 'application/vnd.pgrst.object+json'
  if (method === 'POST' || method === 'PATCH' || method === 'PUT') headers['Prefer'] = 'return=representation'

  const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`PostgREST ${method} ${table}: ${res.status} ${text}`)
  }
  if (res.status === 204) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return res.json() as Promise<any>
}

export const db = {
  select: (table: string, opts?: QueryOptions) => pgRest('GET', table, undefined, opts),
  insert: (table: string, body: unknown, opts?: QueryOptions) => pgRest('POST', table, body, opts),
  update: (table: string, body: unknown, opts?: QueryOptions) => pgRest('PATCH', table, body, opts),
  delete: (table: string, opts?: QueryOptions) => pgRest('DELETE', table, undefined, opts),
}

// ---------------------------------------------------------------------------
// Supabase Storage signed URL (for XLSX downloads)
// ---------------------------------------------------------------------------

export async function createSignedUrl(bucketId: string, path: string, expiresIn = 3600): Promise<string | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucketId}/${path}`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn }),
    })
    if (!res.ok) return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any
    return data?.signedURL ? `${SUPABASE_URL}/storage/v1${data.signedURL}` : (data?.signedUrl ?? null)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Edge function trigger
// Vercel kills the process immediately after res.end(), so fire-and-forget
// never sends the request. We must await before returning the response.
// We race against a 6s timeout — enough for TCP + HTTP send, not the full 150s run.
// ---------------------------------------------------------------------------

async function markRunFailed(runId: string, msg: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/pipeline_runs?id=eq.${runId}`, {
    method: 'PATCH',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'failed', completed_at: new Date().toISOString(), error: msg }),
  }).catch(() => {})
}

export async function fireEdgeFunction(runId: string, orgId: string, dryRun: boolean, maxPlaces?: number): Promise<void> {
  const url = `${SUPABASE_URL}/functions/v1/pipeline-run`
  console.log(`[pipeline/run] calling edge function: ${url} run_id=${runId}`)

  const fetchPromise = fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PIPELINE_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ run_id: runId, org_id: orgId, dry_run: dryRun, ...(maxPlaces != null ? { max_places: maxPlaces } : {}) }),
  })

  // Race: if the edge function responds before 6s it's an immediate error (auth/404).
  // If it times out, the request is in-flight and the 150s run is underway — that's correct.
  const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 6000))

  try {
    const result = await Promise.race([fetchPromise, timeout])
    if (result === 'timeout') {
      console.log(`[pipeline/run] edge function in-flight for run ${runId} (expected — returns after full run)`)
    } else {
      const res = result as Response
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const msg = `Edge function HTTP ${res.status}: ${text}`
        console.error(`[pipeline/run] ${msg}`)
        await markRunFailed(runId, msg)
      } else {
        console.log(`[pipeline/run] edge function completed synchronously for run ${runId}`)
      }
    }
  } catch (err: any) {
    const msg = `Could not reach edge function: ${err?.message ?? String(err)}`
    console.error(`[pipeline/run] ${msg}`)
    await markRunFailed(runId, msg)
  }
}
