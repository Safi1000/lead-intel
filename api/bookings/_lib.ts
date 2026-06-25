/**
 * Server-side helpers for the Bookings proxy. This code runs only on Vercel's
 * Node runtime — never in the browser — so it is the only place the Calendly
 * Personal Access Token (PAT) is ever read. The frontend calls our endpoints;
 * we call Calendly with the secret and return normalized DTOs.
 *
 * Calendly Free plan: no webhooks, no programmatic booking. We only READ here
 * (GET /scheduled_events + invitees) and the booking happens via the embedded
 * widget on the client.
 *
 * Note: this file is intentionally dependency-free (uses global fetch) and is
 * NOT part of the Vite/tsc build (tsconfig includes only `src`).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const CALENDLY_API_BASE = process.env.CALENDLY_API_BASE || 'https://api.calendly.com'

/**
 * One AE, assembled from env vars. Each AE has a short id you choose (e.g.
 * "dana") which becomes the suffix of the env var names:
 *   CALENDLY_PAT__DANA        = <personal access token>   (secret)
 *   CALENDLY_AE_DANA_NAME     = Dana Whitfield
 *   CALENDLY_AE_DANA_URL      = https://calendly.com/dana/30min
 *   CALENDLY_AE_DANA_EMAIL    = dana@yourcompany.com       (the closer's login email)
 */
export interface AeConf {
  id: string
  name: string
  url: string
  email: string
  token: string
}

/** Discover all configured AEs from the CALENDLY_PAT__* env vars. */
export function listAes(): AeConf[] {
  return Object.keys(process.env)
    .filter((k) => k.startsWith('CALENDLY_PAT__'))
    .map((k) => {
      const id = k.slice('CALENDLY_PAT__'.length).toLowerCase()
      const U = id.toUpperCase()
      return {
        id,
        name: process.env[`CALENDLY_AE_${U}_NAME`] || id,
        url: process.env[`CALENDLY_AE_${U}_URL`] || '',
        email: (process.env[`CALENDLY_AE_${U}_EMAIL`] || '').toLowerCase(),
        token: process.env[k] || '',
      }
    })
}

/** Resolve an AE by the value the frontend sends — the closer's login email, or the short id. */
export function resolveAe(identifier: string): AeConf | undefined {
  const v = identifier.trim().toLowerCase()
  return listAes().find((a) => a.email === v || a.id === v)
}

/** Per-AE PAT, by the short id. */
export function tokenForAe(aeId: string): string | undefined {
  return listAes().find((a) => a.id === aeId.toLowerCase())?.token
}

function mapLocation(loc: any): any {
  const type: string = loc?.type ?? 'other'
  const join = loc?.join_url || loc?.location
  switch (type) {
    case 'zoom':
    case 'zoom_conference':
      return { kind: 'zoom', joinUrl: join }
    case 'google_conference':
      return { kind: 'google_meet', joinUrl: join }
    case 'microsoft_teams_conference':
      return { kind: 'ms_teams', joinUrl: join }
    case 'outbound_call':
    case 'inbound_call':
      return { kind: 'phone', detail: loc?.location }
    case 'physical':
      return { kind: 'in_person', detail: loc?.location }
    default:
      return { kind: 'other', detail: loc?.location, joinUrl: typeof join === 'string' && join.startsWith('http') ? join : undefined }
  }
}

/** Pull the answers to our custom questions out of an invitee payload. */
function readCustom(answers: any[]): { setterName?: string; leadSource?: string; context?: string; crmLeadId?: string } {
  const out: any = {}
  for (const a of answers ?? []) {
    const q = String(a?.question ?? '').toLowerCase()
    const ans = a?.answer
    if (!ans) continue
    if (q.includes('setter')) out.setterName = ans
    else if (q.includes('source')) out.leadSource = ans
    else if (q.includes('lead id') || q.includes('crm')) out.crmLeadId = ans
    else if (q.includes('context')) out.context = ans
  }
  return out
}

async function calendly(path: string, token: string): Promise<any> {
  const res = await fetch(`${CALENDLY_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`Calendly ${res.status}: ${await res.text()}`)
  return res.json()
}

/** Resolve the Calendly user URI for a PAT (needed to scope event queries). */
async function currentUserUri(token: string): Promise<string> {
  const me = await calendly('/users/me', token)
  return me?.resource?.uri
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
      // Fallback: match by an email stored in the lead's data JSON.
      const res = await fetch(`${url}/rest/v1/leads?data->>Email=eq.${encodeURIComponent(email)}&limit=1`, { headers })
      const rows = await res.json()
      if (Array.isArray(rows) && rows[0]) return { lead: rows[0], matched: 'matched_by_email' }
    }
  } catch {
    /* fall through to unmatched */
  }
  return { lead: undefined, matched: 'unmatched' }
}

/** Fetch + normalize one AE's upcoming meetings, joined to CRM leads + notes.
 *  `identifier` is the logged-in closer's email (preferred) or the AE's short id. */
export async function getUpcomingForAe(identifier: string): Promise<any[]> {
  const ae = resolveAe(identifier)
  if (!ae || !ae.token) throw new Error(`No Calendly AE configured for "${identifier}".`)
  const aeId = ae.id
  const token = ae.token
  const userUri = await currentUserUri(token)
  const minStart = new Date().toISOString()
  const events = await calendly(
    `/scheduled_events?user=${encodeURIComponent(userUri)}&status=active&min_start_time=${encodeURIComponent(minStart)}&sort=start_time:asc&count=50`,
    token,
  )

  const rows: any[] = []
  for (const ev of events?.collection ?? []) {
    rows.push(await normalizeEvent(ev, aeId, token))
  }
  return rows
}

/** Normalize one Calendly event into a MeetingWithLeadDTO (invitee + lead join). */
async function normalizeEvent(ev: any, aeId: string, token: string): Promise<any> {
  const uuid = String(ev.uri).split('/').pop()
  let invitee: any = {}
  let custom: any = {}
  try {
    const invitees = await calendly(`/scheduled_events/${uuid}/invitees`, token)
    const inv = invitees?.collection?.[0]
    if (inv) {
      invitee = { name: inv.name, email: inv.email, timezone: inv.timezone }
      custom = readCustom(inv.questions_and_answers)
    }
  } catch {
    /* invitee fetch failed — still surface the meeting */
  }
  const join = await lookupLead(custom.crmLeadId, invitee.email)
  const meeting = {
    id: uuid,
    status: ev.status,
    startTime: ev.start_time,
    endTime: ev.end_time,
    eventTypeName: ev.name,
    location: mapLocation(ev.location),
    aeId,
    invitee,
    setter: { name: custom.setterName, leadSource: custom.leadSource, context: custom.context },
    crmLeadId: custom.crmLeadId,
    cancelUrl: ev.cancel_url,
    rescheduleUrl: ev.reschedule_url,
    syncedAt: new Date().toISOString(),
  }
  return { meeting, lead: join.lead, matchConfidence: join.matched, setterNotes: [] }
}

/** Single meeting by uuid. Tries the given AE's token, else scans all AE tokens. */
export async function getMeetingById(id: string, aeIdHint?: string): Promise<any | null> {
  const aes = aeIdHint ? listAes().filter((a) => a.id === aeIdHint.toLowerCase() || a.email === aeIdHint.toLowerCase()) : listAes()
  for (const ae of aes) {
    if (!ae.token) continue
    try {
      const ev = await calendly(`/scheduled_events/${id}`, ae.token)
      if (ev?.resource) return await normalizeEvent(ev.resource, ae.id, ae.token)
    } catch {
      /* try the next AE */
    }
  }
  return null
}

export function sendJson(res: any, status: number, body: unknown) {
  res.status(status).setHeader('Content-Type', 'application/json')
  res.send(JSON.stringify(body))
}
