/**
 * crm — connect an org's CRM and push leads/cold places into it as contacts.
 *
 * Providers: HubSpot, GoHighLevel, Pipedrive, Zoho CRM, Salesforce (all OAuth2 auth-code) and a
 * generic Webhook (Zapier/Make/anything — the org pastes a URL instead of doing OAuth).
 * Tokens/URLs live in crm_connections (RLS: service role only); every push is logged in crm_sync
 * (dedup + status). Deployed with --no-verify-jwt: the provider callback carries no Supabase JWT.
 *
 * Actions (POST, user JWT unless noted):
 *   {action:'status'}                                   -> per-provider {connected, account, autoQualified, autoCold} + configured map
 *   {action:'start', provider}                          -> { url } OAuth consent URL for a popup
 *   {action:'connectWebhook', url}                      -> stores a generic webhook target
 *   {action:'settings', provider, autoQualified, autoCold} -> { ok }
 *   {action:'disconnect', provider}                     -> { ok }
 *   {action:'push', provider, source:'lead'|'cold', ids:[]} -> { results:[{id,status,error?}] }
 *   {action:'sweep'}  (superadmin, or cron via PIPELINE_SECRET bearer) -> auto-sync opted-in orgs
 *   GET ?code=..&state=..                               (provider redirect) -> stores tokens, plain-text page
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const STATE_SECRET = Deno.env.get('OAUTH_STATE_SECRET') ?? ''
// Shared secret the cron scheduler passes (same one the pipeline crons use) to authorize the sweep.
const PIPELINE_SECRET = Deno.env.get('PIPELINE_SECRET') ?? ''
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/crm`

type Provider = 'hubspot' | 'gohighlevel' | 'pipedrive' | 'zoho' | 'salesforce' | 'webhook'
interface ProviderCfg {
  label: string
  kind: 'oauth' | 'webhook'
  authUrl?: string
  tokenUrl?: string
  scope?: string
  authExtras?: Record<string, string>
  clientId: () => string
  clientSecret: () => string
}
const PROVIDERS: Record<Provider, ProviderCfg> = {
  hubspot: {
    label: 'HubSpot', kind: 'oauth',
    authUrl: 'https://app.hubspot.com/oauth/authorize',
    tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
    scope: 'oauth crm.objects.contacts.write crm.objects.contacts.read',
    clientId: () => Deno.env.get('HUBSPOT_CLIENT_ID') ?? '',
    clientSecret: () => Deno.env.get('HUBSPOT_CLIENT_SECRET') ?? '',
  },
  gohighlevel: {
    label: 'GoHighLevel', kind: 'oauth',
    authUrl: 'https://marketplace.gohighlevel.com/oauth/chooselocation',
    tokenUrl: 'https://services.leadconnectorhq.com/oauth/token',
    scope: 'contacts.write contacts.readonly',
    clientId: () => Deno.env.get('GHL_CLIENT_ID') ?? '',
    clientSecret: () => Deno.env.get('GHL_CLIENT_SECRET') ?? '',
  },
  pipedrive: {
    label: 'Pipedrive', kind: 'oauth',
    authUrl: 'https://oauth.pipedrive.com/oauth/authorize',
    tokenUrl: 'https://oauth.pipedrive.com/oauth/token',
    scope: 'contacts:full',
    clientId: () => Deno.env.get('PIPEDRIVE_CLIENT_ID') ?? '',
    clientSecret: () => Deno.env.get('PIPEDRIVE_CLIENT_SECRET') ?? '',
  },
  zoho: {
    label: 'Zoho CRM', kind: 'oauth',
    authUrl: 'https://accounts.zoho.com/oauth/v2/auth',
    tokenUrl: 'https://accounts.zoho.com/oauth/v2/token',
    scope: 'ZohoCRM.modules.contacts.CREATE,ZohoCRM.modules.contacts.READ',
    authExtras: { access_type: 'offline', prompt: 'consent' },
    clientId: () => Deno.env.get('ZOHO_CLIENT_ID') ?? '',
    clientSecret: () => Deno.env.get('ZOHO_CLIENT_SECRET') ?? '',
  },
  salesforce: {
    label: 'Salesforce', kind: 'oauth',
    authUrl: 'https://login.salesforce.com/services/oauth2/authorize',
    tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
    scope: 'api refresh_token',
    clientId: () => Deno.env.get('SALESFORCE_CLIENT_ID') ?? '',
    clientSecret: () => Deno.env.get('SALESFORCE_CLIENT_SECRET') ?? '',
  },
  webhook: {
    label: 'Webhook / Zapier', kind: 'webhook',
    clientId: () => '', clientSecret: () => '',
  },
}
const ALL_PROVIDERS = Object.keys(PROVIDERS) as Provider[]
const isProvider = (p: unknown): p is Provider => typeof p === 'string' && (ALL_PROVIDERS as string[]).includes(p)

// OAuth client creds: prefer the DB (consistent across every edge isolate) over env vars, whose
// propagation can lag/flap for minutes after a `secrets set`. Falls back to env when no DB row exists.
async function getCreds(provider: Provider): Promise<{ id: string; secret: string }> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/crm_provider_config?provider=eq.${provider}&select=client_id,client_secret`, { headers: svc() })
    if (r.ok) { const row = (await r.json())[0]; if (row?.client_id) return { id: row.client_id, secret: row.client_secret ?? '' } }
  } catch { /* fall through to env */ }
  return { id: PROVIDERS[provider].clientId(), secret: PROVIDERS[provider].clientSecret() }
}
// Which OAuth providers have usable client creds (DB row or env). One query, used by `status`.
async function configuredProviders(): Promise<Set<Provider>> {
  const set = new Set<Provider>()
  try {
    const rows = await (await fetch(`${SUPABASE_URL}/rest/v1/crm_provider_config?select=provider,client_id`, { headers: svc() })).json() as Array<{ provider: Provider; client_id: string }>
    for (const r of rows) if (r.client_id && isProvider(r.provider)) set.add(r.provider)
  } catch { /* ignore */ }
  for (const p of ALL_PROVIDERS) if (PROVIDERS[p].kind === 'oauth' && PROVIDERS[p].clientId()) set.add(p)
  return set
}
const providerLabel = (p: Provider) => PROVIDERS[p].label
const hostOf = (u: string) => { try { return new URL(u).host } catch { return u } }
// Zoho is multi-datacenter; the API base's TLD tells us which accounts server to refresh against.
function zohoAccountsServer(apiBase: string | null): string {
  const b = apiBase ?? ''
  if (b.includes('zohoapis.eu')) return 'https://accounts.zoho.eu'
  if (b.includes('zohoapis.in')) return 'https://accounts.zoho.in'
  if (b.includes('zohoapis.com.au') || b.includes('zohoapis.com.cn')) return b.includes('.au') ? 'https://accounts.zoho.com.au' : 'https://accounts.zoho.com.cn'
  if (b.includes('zohoapis.jp')) return 'https://accounts.zoho.jp'
  return 'https://accounts.zoho.com'
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
// Supabase's functions gateway forces text/plain + nosniff, so HTML/scripts don't render. The app
// polls status and closes the popup itself, so the callback just returns a clean plain-text message.
const page = (msg: string, s = 200) => new Response(msg, { status: s, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
const svc = (extra: Record<string, string> = {}) => ({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...extra })

// ---- auth + signed state ----
async function getCaller(auth: string): Promise<{ id: string; role: string; org_id: string | null } | null> {
  if (!auth.startsWith('Bearer ')) return null
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: auth } })
  if (!u.ok) return null
  const user = await u.json()
  if (!user?.id) return null
  const p = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role,org_id`, { headers: svc() })
  const prof = p.ok ? (await p.json())[0] : null
  return { id: user.id, role: prof?.role ?? '', org_id: prof?.org_id ?? null }
}
const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'))
async function hmac(msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(STATE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const s = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg))
  return [...new Uint8Array(s)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
async function makeState(orgId: string, provider: Provider): Promise<string> {
  const p = b64url(`${orgId}|${provider}|${Date.now()}`)
  return `${p}.${await hmac(p)}`
}
async function readState(state: string): Promise<{ orgId: string; provider: Provider } | null> {
  const [p, sig] = state.split('.')
  if (!p || !sig || (await hmac(p)) !== sig) return null
  const [orgId, provider, ts] = unb64url(p).split('|')
  if (!orgId || !isProvider(provider) || Date.now() - Number(ts) > 600_000) return null
  return { orgId, provider }
}

// ---- token exchange / refresh ----
interface TokenResp { access_token: string; refresh_token?: string; expires_in?: number; locationId?: string; hub_id?: number; api_domain?: string; instance_url?: string }
async function exchange(provider: Provider, params: Record<string, string>, tokenUrlOverride?: string): Promise<TokenResp> {
  const cfg = PROVIDERS[provider]
  const url = tokenUrlOverride ?? cfg.tokenUrl!
  const { id, secret } = await getCreds(provider)
  if (!id) throw new Error(`${cfg.label} is not configured on the server.`)
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }
  const bodyParams: Record<string, string> = { ...params }
  // Pipedrive wants client creds in a Basic header; the rest take them in the body.
  if (provider === 'pipedrive') headers.Authorization = 'Basic ' + btoa(`${id}:${secret}`)
  else { bodyParams.client_id = id; bodyParams.client_secret = secret }
  if (provider === 'gohighlevel') bodyParams.user_type = 'Location'
  const res = await fetch(url, { method: 'POST', headers, body: new URLSearchParams(bodyParams) })
  if (!res.ok) throw new Error(`${cfg.label} token error: ${res.status} ${await res.text()}`)
  return await res.json() as TokenResp
}

interface Conn {
  org_id: string; provider: Provider
  access_token: string | null; refresh_token: string | null; token_expiry: string | null
  external_account_id: string | null; account_label: string | null; api_base: string | null; webhook_url: string | null
  auto_sync_qualified: boolean; auto_sync_cold: boolean
}
async function loadConn(orgId: string, provider: Provider): Promise<Conn | null> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/crm_connections?org_id=eq.${orgId}&provider=eq.${provider}&select=*`, { headers: svc() })
  return r.ok ? ((await r.json())[0] ?? null) : null
}
async function accessTokenFor(conn: Conn): Promise<string> {
  const good = conn.access_token && conn.token_expiry && new Date(conn.token_expiry).getTime() - Date.now() > 60_000
  if (good) return conn.access_token!
  if (!conn.refresh_token) throw new Error('Not connected — please reconnect.')
  const override = conn.provider === 'zoho' ? `${zohoAccountsServer(conn.api_base)}/oauth/v2/token` : undefined
  const t = await exchange(conn.provider, { grant_type: 'refresh_token', refresh_token: conn.refresh_token }, override)
  const expiresIn = Number(t.expires_in) || (conn.provider === 'salesforce' ? 7200 : 3600)
  await fetch(`${SUPABASE_URL}/rest/v1/crm_connections?org_id=eq.${conn.org_id}&provider=eq.${conn.provider}`, {
    method: 'PATCH', headers: svc({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ access_token: t.access_token, token_expiry: new Date(Date.now() + expiresIn * 1000).toISOString(), ...(t.refresh_token ? { refresh_token: t.refresh_token } : {}), updated_at: new Date().toISOString() }),
  })
  return t.access_token
}

// ---- field mapping + contact create ----
interface Rec { sourceId: string; name: string; email: string; phone: string; website: string; city: string }
const cityOf = (loc: string) => (loc || '').split(',')[0].trim()

async function loadRecords(source: string, ids: string[], orgId: string): Promise<Rec[]> {
  if (!ids.length) return []
  const inList = `(${ids.map((i) => `"${i.replace(/"/g, '')}"`).join(',')})`
  if (source === 'lead') {
    const rows = await (await fetch(`${SUPABASE_URL}/rest/v1/leads?org_id=eq.${orgId}&id=in.${inList}&select=id,display_name,data`, { headers: svc() })).json() as Array<{ id: string; display_name: string; data: Record<string, string> }>
    return rows.map((l) => ({ sourceId: l.id, name: l.data['Business Name'] || l.display_name || '', email: (l.data['Email'] || '').trim(), phone: (l.data['Phone'] || '').trim(), website: (l.data['Website'] || '').trim(), city: cityOf(l.data['Search Location'] || l.data['City'] || '') }))
  }
  const rows = await (await fetch(`${SUPABASE_URL}/rest/v1/sourced_places?org_id=eq.${orgId}&place_id=in.${inList}&select=place_id,name,email,phone,website,search_location`, { headers: svc() })).json() as Array<{ place_id: string; name: string | null; email: string | null; phone: string | null; website: string | null; search_location: string | null }>
  return rows.map((r) => ({ sourceId: r.place_id, name: r.name ?? '', email: (r.email ?? '').trim(), phone: (r.phone ?? '').trim(), website: (r.website ?? '').trim(), city: cityOf(r.search_location ?? '') }))
}

async function createContact(provider: Provider, token: string, conn: Conn, rec: Rec): Promise<{ id: string } | { duplicate: true }> {
  const fallbackName = rec.name || rec.email || 'Lead'
  switch (provider) {
    case 'hubspot': {
      const props: Record<string, string> = { company: rec.name }
      if (rec.email) props.email = rec.email
      if (rec.phone) props.phone = rec.phone
      if (rec.website) props.website = rec.website
      if (rec.city) props.city = rec.city
      const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ properties: props }) })
      if (res.status === 409) return { duplicate: true }
      if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`)
      return { id: (await res.json()).id }
    }
    case 'gohighlevel': {
      const bodyG: Record<string, unknown> = { locationId: conn.external_account_id, name: rec.name, source: 'LeadIntel' }
      if (rec.email) bodyG.email = rec.email
      if (rec.phone) bodyG.phone = rec.phone
      if (rec.website) bodyG.website = rec.website
      if (rec.city) bodyG.city = rec.city
      const res = await fetch('https://services.leadconnectorhq.com/contacts/', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Version: '2021-07-28' }, body: JSON.stringify(bodyG) })
      if (res.status === 400 && /duplicat/i.test(await res.clone().text())) return { duplicate: true }
      if (!res.ok) throw new Error(`GoHighLevel ${res.status}: ${await res.text()}`)
      const j = await res.json()
      return { id: j.contact?.id ?? j.id ?? '' }
    }
    case 'pipedrive': {
      const base = conn.api_base || 'https://api.pipedrive.com'
      const bodyP: Record<string, unknown> = { name: fallbackName }
      if (rec.email) bodyP.email = rec.email
      if (rec.phone) bodyP.phone = rec.phone
      const res = await fetch(`${base}/api/v1/persons`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(bodyP) })
      if (!res.ok) throw new Error(`Pipedrive ${res.status}: ${await res.text()}`)
      return { id: String((await res.json()).data?.id ?? '') }
    }
    case 'zoho': {
      const base = conn.api_base || 'https://www.zohoapis.com'
      const row: Record<string, unknown> = { Last_Name: fallbackName }
      if (rec.name) row.Account_Name = rec.name
      if (rec.email) row.Email = rec.email
      if (rec.phone) row.Phone = rec.phone
      if (rec.city) row.Mailing_City = rec.city
      if (rec.website) row.Description = `Website: ${rec.website}`
      const res = await fetch(`${base}/crm/v2/Contacts`, { method: 'POST', headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: [row] }) })
      if (!res.ok) throw new Error(`Zoho ${res.status}: ${await res.text()}`)
      const rec0 = (await res.json()).data?.[0]
      if (rec0?.code === 'DUPLICATE_DATA') return { duplicate: true }
      if (rec0 && rec0.status !== 'success') throw new Error(`Zoho: ${rec0.code ?? 'error'}`)
      return { id: String(rec0?.details?.id ?? '') }
    }
    case 'salesforce': {
      if (!conn.api_base) throw new Error('Salesforce instance not set — reconnect.')
      const bodyS: Record<string, unknown> = { LastName: fallbackName, Company: rec.name || 'Unknown' }
      if (rec.email) bodyS.Email = rec.email
      if (rec.phone) bodyS.Phone = rec.phone
      if (rec.website) bodyS.Website = rec.website
      if (rec.city) bodyS.City = rec.city
      const res = await fetch(`${conn.api_base}/services/data/v59.0/sobjects/Lead`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(bodyS) })
      if (res.status === 400) {
        const t = await res.text()
        if (/DUPLICATE/i.test(t)) return { duplicate: true }
        throw new Error(`Salesforce 400: ${t}`)
      }
      if (!res.ok) throw new Error(`Salesforce ${res.status}: ${await res.text()}`)
      return { id: String((await res.json()).id ?? '') }
    }
    case 'webhook': {
      if (!conn.webhook_url) throw new Error('No webhook URL set.')
      const res = await fetch(conn.webhook_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'LeadIntel', business_name: rec.name, email: rec.email, phone: rec.phone, website: rec.website, city: rec.city }) })
      if (!res.ok) throw new Error(`Webhook ${res.status}`)
      return { id: 'webhook' }
    }
  }
}

// ---- shared push: dedup, map, create contacts, log crm_sync (used by manual push + the sweep) ----
async function syncIds(orgId: string, provider: Provider, source: 'lead' | 'cold', ids: string[], conn: Conn): Promise<Array<{ id: string; status: string; error?: string }>> {
  const results: Array<{ id: string; status: string; error?: string }> = []
  if (!ids.length) return results
  const inList = `(${ids.map((i) => `"${i.replace(/"/g, '')}"`).join(',')})`
  // Skip anything already synced (dedup).
  const already = new Set((await (await fetch(`${SUPABASE_URL}/rest/v1/crm_sync?org_id=eq.${orgId}&provider=eq.${provider}&source_type=eq.${source}&source_id=in.${inList}&status=eq.synced&select=source_id`, { headers: svc() })).json() as Array<{ source_id: string }>).map((r) => r.source_id))
  for (const id of ids) if (already.has(id)) results.push({ id, status: 'skipped' })
  const recs = await loadRecords(source, ids.filter((i) => !already.has(i)), orgId)
  if (!recs.length) return results
  const token = conn.provider === 'webhook' ? '' : await accessTokenFor(conn)
  for (const rec of recs) {
    try {
      const r = await createContact(provider, token, conn, rec)
      const externalId = 'duplicate' in r ? null : r.id
      await fetch(`${SUPABASE_URL}/rest/v1/crm_sync?on_conflict=org_id,provider,source_type,source_id`, { method: 'POST', headers: svc({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify({ org_id: orgId, provider, source_type: source, source_id: rec.sourceId, external_id: externalId, status: 'synced', error: null, synced_at: new Date().toISOString() }) })
      results.push({ id: rec.sourceId, status: 'duplicate' in r ? 'duplicate' : 'synced' })
    } catch (e) {
      const msg = (e as Error).message.slice(0, 400)
      await fetch(`${SUPABASE_URL}/rest/v1/crm_sync?on_conflict=org_id,provider,source_type,source_id`, { method: 'POST', headers: svc({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify({ org_id: orgId, provider, source_type: source, source_id: rec.sourceId, external_id: null, status: 'failed', error: msg, synced_at: new Date().toISOString() }) })
      results.push({ id: rec.sourceId, status: 'failed', error: msg })
    }
  }
  return results
}

// ---- auto-sync sweep (cron): push new, un-synced records for every org that opted in ----
// Pushing a contact is network-bound (~300ms each), so each run handles a bounded slice and, when it
// fills that slice (backlog remains), immediately chains the next run — the same self-invoke pattern
// pipeline-run uses. A 1,500-lead batch therefore drains in ~one continuous chain (minutes), not over
// hours of 10-minute cron ticks; the cron itself is just the safety net that kicks the chain off.
const SWEEP_CANDIDATES = 1000  // newest N rows scanned per org/source
const SWEEP_CAP = 100          // max pushed per org/source per run (short, chainable invocations)
const MAX_SWEEP_DEPTH = 60     // chain guard (~60 × 100 = up to 6k/source per chain; cron resumes rest)

// Fire the next sweep in the chain (the function invokes itself). Race-then-return so the next isolate
// is in-flight before this one exits, but we never block on the whole downstream run.
async function chainNextSweep(depth: number): Promise<void> {
  const fetchPromise = fetch(`${SUPABASE_URL}/functions/v1/crm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PIPELINE_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'sweep', depth }),
  }).catch((e) => { console.error('[crm-sweep chain] failed:', (e as Error).message); return null })
  await Promise.race([fetchPromise, new Promise((r) => setTimeout(() => r('timeout'), 5000))])
}

async function candidateIds(orgId: string, source: 'lead' | 'cold'): Promise<string[]> {
  if (source === 'lead') {
    const rows = await (await fetch(`${SUPABASE_URL}/rest/v1/leads?org_id=eq.${orgId}&select=id&order=created_at.desc&limit=${SWEEP_CANDIDATES}`, { headers: svc() })).json() as Array<{ id: string }>
    return rows.map((r) => r.id)
  }
  // Cold pool: mirror the Cold Leads view — not yet imported, no scan error, on-target niche.
  const rows = await (await fetch(`${SUPABASE_URL}/rest/v1/sourced_places?org_id=eq.${orgId}&crm_lead_id=is.null&error=is.null&select=place_id,is_correct_niche&order=created_at.desc&limit=${SWEEP_CANDIDATES}`, { headers: svc() })).json() as Array<{ place_id: string; is_correct_niche: boolean | null }>
  return rows.filter((r) => r.is_correct_niche !== false).map((r) => r.place_id)
}

async function unsyncedIds(orgId: string, provider: Provider, source: 'lead' | 'cold'): Promise<string[]> {
  const cand = await candidateIds(orgId, source)
  if (!cand.length) return []
  const inList = `(${cand.map((i) => `"${i.replace(/"/g, '')}"`).join(',')})`
  const done = new Set((await (await fetch(`${SUPABASE_URL}/rest/v1/crm_sync?org_id=eq.${orgId}&provider=eq.${provider}&source_type=eq.${source}&source_id=in.${inList}&status=eq.synced&select=source_id`, { headers: svc() })).json() as Array<{ source_id: string }>).map((r) => r.source_id))
  return cand.filter((i) => !done.has(i)).slice(0, SWEEP_CAP)
}

async function runSweep(): Promise<{ orgs: number; pushed: number; failed: number; more: boolean }> {
  const conns = await (await fetch(`${SUPABASE_URL}/rest/v1/crm_connections?or=(auto_sync_qualified.eq.true,auto_sync_cold.eq.true)&select=*`, { headers: svc() })).json() as Conn[]
  let pushed = 0, failed = 0, more = false
  for (const conn of conns) {
    try {
      const jobs: Array<'lead' | 'cold'> = []
      if (conn.auto_sync_qualified) jobs.push('lead')
      if (conn.auto_sync_cold) jobs.push('cold')
      for (const source of jobs) {
        const ids = await unsyncedIds(conn.org_id, conn.provider, source)
        if (!ids.length) continue
        if (ids.length === SWEEP_CAP) more = true // filled the slice → backlog likely remains
        const results = await syncIds(conn.org_id, conn.provider, source, ids, conn)
        pushed += results.filter((r) => r.status === 'synced' || r.status === 'duplicate').length
        failed += results.filter((r) => r.status === 'failed').length
      }
    } catch (e) {
      failed++
      console.error(`[crm-sweep] ${conn.org_id}/${conn.provider}: ${(e as Error).message}`)
    }
  }
  return { orgs: conns.length, pushed, failed, more }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = new URL(req.url)

  try {
    // --- cron auto-sync sweep (POST, shared-secret auth, no user JWT) ---
    if (req.method === 'POST' && PIPELINE_SECRET && (req.headers.get('Authorization') ?? '') === `Bearer ${PIPELINE_SECRET}`) {
      const b = await req.json().catch(() => ({})) as Record<string, unknown>
      const depth = Number(b.depth ?? 0)
      const res = await runSweep()
      if (res.more && depth < MAX_SWEEP_DEPTH) await chainNextSweep(depth + 1)
      return json({ ok: true, depth, ...res })
    }

    // --- provider OAuth callback (GET, no JWT) ---
    if (req.method === 'GET' && url.searchParams.has('code')) {
      const st = await readState(url.searchParams.get('state') ?? '')
      if (!st) return page('Link expired or invalid. Close this window and try again.', 400)
      // Zoho returns the datacenter's accounts server to exchange the code against.
      const tokenUrlOverride = st.provider === 'zoho'
        ? `${(url.searchParams.get('accounts-server') ?? 'https://accounts.zoho.com').replace(/\/$/, '')}/oauth/v2/token`
        : undefined
      const tok = await exchange(st.provider, { grant_type: 'authorization_code', code: url.searchParams.get('code')!, redirect_uri: REDIRECT_URI }, tokenUrlOverride)

      // Identify the connected account + per-tenant API base for display/API calls.
      let accountId: string | null = null, label: string | null = null, apiBase: string | null = null
      if (st.provider === 'hubspot') {
        const info = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${tok.access_token}`).then((r) => r.ok ? r.json() : null)
        accountId = info?.hub_id ? String(info.hub_id) : null
        label = info?.hub_domain ?? null
      } else if (st.provider === 'gohighlevel') {
        accountId = tok.locationId ?? null
      } else if (st.provider === 'pipedrive') {
        apiBase = tok.api_domain ?? null; accountId = apiBase; label = apiBase ? hostOf(apiBase) : 'Pipedrive'
      } else if (st.provider === 'zoho') {
        apiBase = tok.api_domain ?? null; accountId = apiBase; label = 'Zoho CRM'
      } else if (st.provider === 'salesforce') {
        apiBase = tok.instance_url ?? null; accountId = apiBase; label = apiBase ? hostOf(apiBase) : 'Salesforce'
      }
      const expiresIn = Number(tok.expires_in) || (st.provider === 'salesforce' ? 7200 : 3600)
      const patch: Record<string, unknown> = {
        org_id: st.orgId, provider: st.provider, access_token: tok.access_token,
        token_expiry: new Date(Date.now() + expiresIn * 1000).toISOString(),
        external_account_id: accountId, account_label: label, api_base: apiBase,
        connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      if (tok.refresh_token) patch.refresh_token = tok.refresh_token
      await fetch(`${SUPABASE_URL}/rest/v1/crm_connections?on_conflict=org_id,provider`, { method: 'POST', headers: svc({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(patch) })
      return page(`✅ ${providerLabel(st.provider)} connected. You can close this window.`)
    }
    if (req.method === 'GET') return json({ ok: true, service: 'crm' })

    // --- authenticated actions ---
    const caller = await getCaller(req.headers.get('Authorization') ?? '')
    if (!caller) return json({ error: 'unauthorized' }, 401)
    if (!['superadmin', 'admin', 'manager', 'owner'].includes(caller.role)) return json({ error: 'forbidden' }, 403)
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const orgId = caller.org_id ?? (['superadmin', 'admin'].includes(caller.role) ? (body.orgId as string) : null)
    if (!orgId) return json({ error: 'no organization in context' }, 400)
    const action = body.action

    if (action === 'status') {
      const rows = await (await fetch(`${SUPABASE_URL}/rest/v1/crm_connections?org_id=eq.${orgId}&select=provider,account_label,external_account_id,webhook_url,auto_sync_qualified,auto_sync_cold`, { headers: svc() })).json() as Array<{ provider: Provider; account_label: string | null; external_account_id: string | null; webhook_url: string | null; auto_sync_qualified: boolean; auto_sync_cold: boolean }>
      const out: Record<string, unknown> = {}
      for (const p of ALL_PROVIDERS) out[p] = null
      for (const r of rows) {
        const account = r.provider === 'webhook' ? (r.webhook_url ? hostOf(r.webhook_url) : 'Webhook') : (r.account_label ?? r.external_account_id)
        out[r.provider] = { connected: true, account, autoQualified: r.auto_sync_qualified, autoCold: r.auto_sync_cold }
      }
      const usable = await configuredProviders()
      const configured: Record<string, boolean> = {}
      for (const p of ALL_PROVIDERS) configured[p] = PROVIDERS[p].kind === 'webhook' ? true : usable.has(p)
      out.configured = configured
      return json(out)
    }

    if (action === 'start') {
      if (!isProvider(body.provider) || PROVIDERS[body.provider].kind !== 'oauth') return json({ error: 'unknown provider' }, 400)
      const cfg = PROVIDERS[body.provider]
      const { id } = await getCreds(body.provider)
      if (!id) return json({ error: `${cfg.label} is not configured yet.` }, 400)
      const params = new URLSearchParams({ client_id: id, redirect_uri: REDIRECT_URI, response_type: 'code', scope: cfg.scope ?? '', state: await makeState(orgId, body.provider), ...(cfg.authExtras ?? {}) })
      return json({ url: `${cfg.authUrl}?${params}` })
    }

    if (action === 'connectWebhook') {
      const wurl = String(body.url ?? '').trim()
      if (!/^https:\/\/.+/i.test(wurl)) return json({ error: 'Enter a valid https:// URL.' }, 400)
      await fetch(`${SUPABASE_URL}/rest/v1/crm_connections?on_conflict=org_id,provider`, { method: 'POST', headers: svc({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify({ org_id: orgId, provider: 'webhook', webhook_url: wurl, account_label: 'Webhook', connected_at: new Date().toISOString(), updated_at: new Date().toISOString() }) })
      return json({ ok: true })
    }

    if (action === 'settings') {
      if (!isProvider(body.provider)) return json({ error: 'unknown provider' }, 400)
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (typeof body.autoQualified === 'boolean') patch.auto_sync_qualified = body.autoQualified
      if (typeof body.autoCold === 'boolean') patch.auto_sync_cold = body.autoCold
      await fetch(`${SUPABASE_URL}/rest/v1/crm_connections?org_id=eq.${orgId}&provider=eq.${body.provider}`, { method: 'PATCH', headers: svc({ Prefer: 'return=minimal' }), body: JSON.stringify(patch) })
      return json({ ok: true })
    }

    if (action === 'disconnect') {
      if (!isProvider(body.provider)) return json({ error: 'unknown provider' }, 400)
      await fetch(`${SUPABASE_URL}/rest/v1/crm_connections?org_id=eq.${orgId}&provider=eq.${body.provider}`, { method: 'DELETE', headers: svc({ Prefer: 'return=minimal' }) })
      return json({ ok: true })
    }

    if (action === 'push') {
      if (!isProvider(body.provider)) return json({ error: 'unknown provider' }, 400)
      const source = body.source === 'cold' ? 'cold' : 'lead'
      const ids = Array.isArray(body.ids) ? (body.ids as string[]).slice(0, 500) : []
      if (!ids.length) return json({ error: 'no ids' }, 400)
      const conn = await loadConn(orgId, body.provider)
      if (!conn) return json({ error: `${providerLabel(body.provider)} not connected.` }, 400)
      return json({ results: await syncIds(orgId, body.provider, source, ids, conn) })
    }

    // Manual sweep trigger (superadmin/admin) — same job the cron runs.
    if (action === 'sweep') {
      if (!['superadmin', 'admin'].includes(caller.role)) return json({ error: 'forbidden' }, 403)
      const depth = Number(body.depth ?? 0)
      const res = await runSweep()
      if (res.more && depth < MAX_SWEEP_DEPTH) await chainNextSweep(depth + 1)
      return json({ ok: true, ...res })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
