/**
 * Server-side helpers for the Bookings proxy. This code runs only on Vercel's
 * Node runtime — never in the browser — so it is the only place a Cal.com API
 * key is ever read. The frontend calls our endpoints; we call Cal.com with the
 * secret and return normalized DTOs.
 *
 * Provider: Cal.com (api.cal.com v2). We only READ here
 * (GET /v2/bookings); the booking happens via the embedded Cal.com widget on
 * the client, and freshness comes from Cal.com webhooks (see webhook.ts) with
 * polling as a fallback.
 *
 * Note: this file is intentionally dependency-free (uses global fetch) and is
 * NOT part of the Vite/tsc build (tsconfig includes only `src`).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const CAL_API_BASE = process.env.CAL_API_BASE || 'https://api.cal.com/v2'
// Cal.com versions its endpoints by date; this is the bookings API version.
const CAL_API_VERSION = process.env.CAL_API_VERSION || '2024-08-13'

/**
 * One AE, assembled from env vars. Each AE has a short id you choose (e.g.
 * "hamna") which becomes the suffix of the env var names:
 *   CAL_API_KEY__HAMNA      = <cal.com api key>          (secret)
 *   CAL_AE_HAMNA_NAME       = Hamna
 *   CAL_AE_HAMNA_URL        = https://cal.com/hamna/30min
 *   CAL_AE_HAMNA_EMAIL      = hamna@yourcompany.com       (the closer's LOGIN email)
 */
export interface AeConf {
  id: string
  name: string
  url: string
  email: string
  apiKey: string
}

/** Discover all configured AEs from the CAL_API_KEY__* env vars. */
export function listAes(): AeConf[] {
  return Object.keys(process.env)
    .filter((k) => k.startsWith('CAL_API_KEY__'))
    .map((k) => {
      const id = k.slice('CAL_API_KEY__'.length).toLowerCase()
      const U = id.toUpperCase()
      return {
        id,
        name: process.env[`CAL_AE_${U}_NAME`] || id,
        url: process.env[`CAL_AE_${U}_URL`] || '',
        email: (process.env[`CAL_AE_${U}_EMAIL`] || '').toLowerCase(),
        apiKey: process.env[k] || '',
      }
    })
}

/** Resolve an AE by the value the frontend sends — the closer's login email, or the short id. */
export function resolveAe(identifier: string): AeConf | undefined {
  const v = identifier.trim().toLowerCase()
  return listAes().find((a) => a.email === v || a.id === v)
}

/** Map a Cal.com location string to our normalized location DTO. */
function mapLocation(loc: any): any {
  const raw = typeof loc === 'string' ? loc : loc?.type || loc?.location || ''
  const url = typeof loc === 'object' ? loc?.link || loc?.url || loc?.join_url : undefined
  const s = String(raw).toLowerCase()
  if (s.includes('zoom')) return { kind: 'zoom', joinUrl: url || (s.startsWith('http') ? raw : undefined) }
  if (s.includes('google') || s.includes('meet')) return { kind: 'google_meet', joinUrl: url }
  if (s.includes('teams') || s.includes('office365')) return { kind: 'ms_teams', joinUrl: url }
  if (s.includes('phone') || s.includes('number')) return { kind: 'phone', detail: typeof loc === 'object' ? loc?.location : undefined }
  if (s.includes('inperson') || s.includes('in_person') || s.includes('attendeeaddress')) return { kind: 'in_person', detail: typeof loc === 'object' ? loc?.location || loc?.address : raw }
  if (s.startsWith('http')) return { kind: 'other', joinUrl: raw }
  return { kind: 'other', detail: typeof raw === 'string' ? raw : undefined }
}

/** Pull our custom-question answers out of a Cal.com booking's field responses. */
function readCustom(responses: any): { setterName?: string; leadSource?: string; context?: string; crmLeadId?: string } {
  const out: any = {}
  const obj = responses && typeof responses === 'object' ? responses : {}
  for (const [rawKey, rawVal] of Object.entries(obj)) {
    const key = rawKey.toLowerCase()
    // Cal.com responses can be a plain value or { value, label }.
    const val = (rawVal && typeof rawVal === 'object' && 'value' in (rawVal as any)) ? (rawVal as any).value : rawVal
    if (val == null || val === '') continue
    const v = String(val)
    if (key.includes('setter')) out.setterName = v
    else if (key.includes('source')) out.leadSource = v
    else if (key.includes('crm') || key.includes('lead-id') || key.includes('leadid') || key.includes('lead_id')) out.crmLeadId = v
    else if (key.includes('context') || key.includes('notes')) out.context = v
  }
  return out
}

async function cal(path: string, apiKey: string): Promise<any> {
  const res = await fetch(`${CAL_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, 'cal-api-version': CAL_API_VERSION, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`Cal.com ${res.status}: ${await res.text()}`)
  return res.json()
}

/** Optional CRM lead lookup via Supabase PostgREST (service role, server-side). */
async function lookupLead(crmLeadId?: string, email?: string): Promise<{ lead?: any; matched: 'matched_by_id' | 'matched_by_email' | 'unmatched' }> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return { lead: undefined, matched: crmLeadId ? 'matched_by_id' : 'unmatched' }
  const headers = { apikey: key, Authorization: `Bearer ${key}` }
  try {
    if (crmLeadId) {
      const res = await fetch(`${url}/rest/v1/leads?id=eq.${encodeURIComponent(crmLeadId)}&limit=1`, { headers })
      const rows = await res.json()
      if (Array.isArray(rows) && rows[0]) return { lead: rows[0], matched: 'matched_by_id' }
    }
    if (email) {
      const res = await fetch(`${url}/rest/v1/leads?data->>Email=eq.${encodeURIComponent(email)}&limit=1`, { headers })
      const rows = await res.json()
      if (Array.isArray(rows) && rows[0]) return { lead: rows[0], matched: 'matched_by_email' }
    }
  } catch {
    /* fall through to unmatched */
  }
  return { lead: undefined, matched: 'unmatched' }
}

/** Normalize one Cal.com booking into a MeetingWithLeadDTO (attendee + lead join). */
async function normalizeBooking(bk: any, aeId: string): Promise<any> {
  const uid = bk.uid || String(bk.id)
  const attendee = Array.isArray(bk.attendees) ? bk.attendees[0] : bk.attendee
  const invitee = attendee ? { name: attendee.name, email: attendee.email, timezone: attendee.timeZone } : {}
  const custom = readCustom(bk.bookingFieldsResponses ?? bk.responses ?? bk.customInputs)
  const join = await lookupLead(custom.crmLeadId, invitee.email)
  const meeting = {
    id: uid,
    status: bk.status === 'cancelled' || bk.status === 'canceled' ? 'canceled' : 'active',
    startTime: bk.start ?? bk.startTime,
    endTime: bk.end ?? bk.endTime,
    eventTypeName: bk.title ?? bk.eventType?.title ?? bk.eventType?.slug ?? 'Meeting',
    location: mapLocation(bk.location),
    aeId,
    invitee,
    setter: { name: custom.setterName, leadSource: custom.leadSource, context: custom.context },
    crmLeadId: custom.crmLeadId,
    cancelUrl: `https://cal.com/booking/${uid}?cancel=true`,
    rescheduleUrl: `https://cal.com/reschedule/${uid}`,
    syncedAt: new Date().toISOString(),
  }
  return { meeting, lead: join.lead, matchConfidence: join.matched, setterNotes: [] }
}

/** Fetch + normalize one AE's upcoming meetings, joined to CRM leads + notes.
 *  `identifier` is the logged-in closer's email (preferred) or the AE's short id. */
export async function getUpcomingForAe(identifier: string): Promise<any[]> {
  const ae = resolveAe(identifier)
  if (!ae || !ae.apiKey) throw new Error(`No Cal.com AE configured for "${identifier}".`)
  const data = await cal(`/bookings?status=upcoming&sortStart=asc&take=50`, ae.apiKey)
  const bookings: any[] = data?.data ?? data?.bookings ?? []
  const now = Date.now()
  const rows: any[] = []
  for (const bk of bookings) {
    const start = new Date(bk.start ?? bk.startTime).getTime()
    if ((bk.status === 'cancelled' || bk.status === 'canceled') || start < now) continue
    rows.push(await normalizeBooking(bk, ae.id))
  }
  return rows.sort((a, b) => new Date(a.meeting.startTime).getTime() - new Date(b.meeting.startTime).getTime())
}

/** Single meeting by uid. Tries the given AE, else scans all AEs. */
export async function getMeetingById(id: string, aeIdHint?: string): Promise<any | null> {
  const aes = aeIdHint ? listAes().filter((a) => a.id === aeIdHint.toLowerCase() || a.email === aeIdHint.toLowerCase()) : listAes()
  for (const ae of aes) {
    if (!ae.apiKey) continue
    try {
      const data = await cal(`/bookings/${id}`, ae.apiKey)
      const bk = data?.data ?? data?.booking
      if (bk) return await normalizeBooking(bk, ae.id)
    } catch {
      /* try the next AE */
    }
  }
  return null
}

/** Write a JSON response using raw Node APIs (no dependency on Vercel's res
 *  helper chain, which can throw and turn a clean error into a 500). */
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

/** Read a query param robustly (req.query, falling back to parsing req.url). */
export function readQuery(req: any, key: string): string {
  if (req?.query && req.query[key] != null) return String(req.query[key])
  try {
    return new URL(req.url, 'http://localhost').searchParams.get(key) ?? ''
  } catch {
    return ''
  }
}

/** Broadcast a lightweight "bookings changed" ping to the browser via Supabase
 *  Realtime (HTTP broadcast endpoint, no dependency). Clients refetch on it.
 *  No-op (and harmless) if Supabase env vars are not configured. */
export async function broadcastBookingsChanged(trigger: string): Promise<void> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !key) return
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ topic: 'bookings-changes', event: 'changed', payload: { trigger, at: Date.now() } }],
      }),
    })
  } catch {
    /* best-effort — polling still keeps the list fresh */
  }
}
