/**
 * cold-leads — read the "cold" pool: businesses we scanned but never imported as CRM leads.
 *
 * They already live in `sourced_places` (RLS-locked to service role), so this function serves them
 * to overseers (manager/owner/admin/superadmin), scoped to their org, with geo + niche filters and
 * CSV export. Niche isn't a column — we map each row's `search_term` to a vertical via the
 * `verticals` table (e.g. "med spa"/"botox clinic" -> med_spa; "orthodontist"/"dentist" -> dental).
 *
 * Actions (POST, user JWT):
 *   {action:'facets'}                        -> { total, withEmail, withPhone, locations[], niches[] }
 *   {action:'list', ...filters, limit, offset} -> { rows[], total }
 *   {action:'export', ...filters}            -> { rows[] }   (capped; frontend builds the CSV)
 *
 * Filters: location (exact search_location), niche (vertical key), hasEmail, hasPhone, q (name search).
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const EXPORT_CAP = 20000

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const svc = (extra: Record<string, string> = {}) => ({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...extra })

async function getCaller(auth: string): Promise<{ id: string; role: string; org_id: string | null } | null> {
  if (!auth.startsWith('Bearer ')) return null
  const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: auth } })
  if (!ures.ok) return null
  const u = await ures.json()
  if (!u?.id) return null
  const pres = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${u.id}&select=role,org_id`, { headers: svc() })
  const prof = pres.ok ? (await pres.json())[0] : null
  return { id: u.id, role: prof?.role ?? '', org_id: prof?.org_id ?? null }
}

async function fetchAll<T>(pathQs: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathQs}`, { headers: svc({ 'Range-Unit': 'items', Range: `${from}-${from + 999}` }) })
    if (!res.ok) break
    const page = await res.json() as T[]
    out.push(...page)
    if (page.length < 1000) break
  }
  return out
}

interface Vertical { key: string; label: string; search_terms: string[] }
interface RawPlace {
  place_id: string; name: string | null; address: string | null; phone: string | null; website: string | null
  rating: number | null; email: string | null; email_confidence: string | null; search_location: string | null
  search_term: string | null; website_status: string | null; is_correct_niche: boolean | null; created_at: string
}
interface ColdLead {
  place_id: string; name: string; address: string; phone: string; website: string; rating: number | null
  email: string; email_confidence: string; location: string; niche_key: string; niche_label: string; website_status: string
}

async function loadCold(orgId: string): Promise<ColdLead[]> {
  const verticals = await fetchAll<Vertical>('verticals?select=key,label,search_terms')
  const termToNiche = new Map<string, { key: string; label: string }>()
  for (const v of verticals) for (const t of (v.search_terms ?? [])) termToNiche.set(t.toLowerCase().trim(), { key: v.key, label: v.label })

  const raw = await fetchAll<RawPlace>(
    `sourced_places?org_id=eq.${orgId}&crm_lead_id=is.null&error=is.null&select=place_id,name,address,phone,website,rating,email,email_confidence,search_location,search_term,website_status,is_correct_niche,created_at`)

  return raw
    .filter((r) => r.is_correct_niche !== false) // drop off-target hits (wrong business type)
    .map((r) => {
      const n = termToNiche.get((r.search_term ?? '').toLowerCase().trim())
      return {
        place_id: r.place_id, name: r.name ?? '', address: r.address ?? '', phone: r.phone ?? '',
        website: r.website ?? '', rating: r.rating, email: r.email ?? '', email_confidence: r.email_confidence ?? '',
        location: r.search_location ?? '', niche_key: n?.key ?? 'other', niche_label: n?.label ?? 'Other',
        website_status: r.website_status ?? '',
      }
    })
}

function applyFilters(rows: ColdLead[], f: Record<string, unknown>): ColdLead[] {
  const loc = (f.location as string) || '', niche = (f.niche as string) || ''
  const q = ((f.q as string) || '').toLowerCase().trim()
  return rows.filter((r) =>
    (!loc || r.location === loc) &&
    (!niche || r.niche_key === niche) &&
    (!f.hasEmail || !!r.email) &&
    (!f.hasPhone || !!r.phone) &&
    (!q || r.name.toLowerCase().includes(q)))
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: true, service: 'cold-leads' })

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  try {
    const caller = await getCaller(req.headers.get('Authorization') ?? '')
    if (!caller) return json({ error: 'unauthorized' }, 401)
    if (!['superadmin', 'admin', 'manager', 'owner'].includes(caller.role)) return json({ error: 'forbidden' }, 403)
    // Org: a tenant user is pinned to their own org; SA/admin may pass an org they've entered.
    const orgId = caller.org_id ?? (['superadmin', 'admin'].includes(caller.role) ? (body.orgId as string) : null)
    if (!orgId) return json({ error: 'no organization in context' }, 400)

    const all = await loadCold(orgId)
    const action = body.action

    if (action === 'facets') {
      const byLoc = new Map<string, number>(), byNiche = new Map<string, { label: string; count: number }>()
      for (const r of all) {
        if (r.location) byLoc.set(r.location, (byLoc.get(r.location) ?? 0) + 1)
        const n = byNiche.get(r.niche_key) ?? { label: r.niche_label, count: 0 }; n.count++; byNiche.set(r.niche_key, n)
      }
      return json({
        total: all.length,
        withEmail: all.filter((r) => r.email).length,
        withPhone: all.filter((r) => r.phone).length,
        locations: [...byLoc.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
        niches: [...byNiche.entries()].map(([key, v]) => ({ key, label: v.label, count: v.count })).sort((a, b) => b.count - a.count),
      })
    }

    const filtered = applyFilters(all, body).sort((a, b) => a.name.localeCompare(b.name))

    if (action === 'export') return json({ rows: filtered.slice(0, EXPORT_CAP), total: filtered.length })

    if (action === 'list') {
      const limit = Math.min(Number(body.limit) || 50, 200)
      const offset = Number(body.offset) || 0
      return json({ rows: filtered.slice(offset, offset + limit), total: filtered.length })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
