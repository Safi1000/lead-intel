/**
 * Shared helpers for the pipeline serverless endpoints.
 * Mirrors the pattern in api/bookings/_lib.ts — raw Node req/res,
 * no framework dependency, PostgREST for Supabase access.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const SUPABASE_URL = process.env.SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
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

/** Returns true and sends 401 if the request lacks a valid PIPELINE_SECRET token. */
export function requireToken(req: any, res: any): boolean {
  if (!PIPELINE_SECRET) return false // misconfigured — let it through so it fails loudly elsewhere
  const fromQuery = readQuery(req, 'token')
  const fromHeader = (req.headers?.authorization ?? '').replace(/^Bearer\s+/i, '')
  if (fromQuery === PIPELINE_SECRET || fromHeader === PIPELINE_SECRET) return false
  sendJson(res, 401, { error: { code: 'unauthorized', message: 'Missing or invalid token.' } })
  return true
}

// ---------------------------------------------------------------------------
// Supabase PostgREST admin client (service role, bypasses RLS)
// ---------------------------------------------------------------------------

export interface QueryOptions {
  select?: string
  filters?: string  // e.g. 'org_id=eq.xxx&status=eq.running'
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
  return res.json()
}

export const db = {
  select: (table: string, opts?: QueryOptions) => pgRest('GET', table, undefined, opts),
  insert: (table: string, body: unknown, opts?: QueryOptions) => pgRest('POST', table, body, opts),
  update: (table: string, body: unknown, opts?: QueryOptions) => pgRest('PATCH', table, body, opts),
  upsert: (table: string, body: unknown, opts?: QueryOptions) => pgRest('POST', table, body, { ...opts }),
  delete: (table: string, opts?: QueryOptions) => pgRest('DELETE', table, undefined, opts),
  rpc: (fn: string, args: unknown) =>
    fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    }).then((r) => r.json()),
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
    const data = await res.json()
    return data?.signedURL ? `${SUPABASE_URL}/storage/v1${data.signedURL}` : (data?.signedUrl ?? null)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Edge function trigger (fire-and-forget)
// ---------------------------------------------------------------------------

export function fireEdgeFunction(runId: string, orgId: string, dryRun: boolean): void {
  const url = `${SUPABASE_URL}/functions/v1/pipeline-run`
  // Not awaited — returns 202 immediately, edge function runs independently
  fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PIPELINE_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ run_id: runId, org_id: orgId, dry_run: dryRun }),
  }).catch(() => { /* edge function errors surface in pipeline_runs.error */ })
}
