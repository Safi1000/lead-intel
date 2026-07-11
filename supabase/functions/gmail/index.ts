/**
 * gmail — send a follow-up email from the user's own Gmail (e.g. hamna@techxserve.com).
 *
 * One edge function, four actions:
 *   POST {action:'start'}            (auth: user JWT) -> { url } Google consent URL to open in a popup
 *   GET  ?code=...&state=...          (Google redirect) -> stores tokens, returns a self-closing page
 *   POST {action:'status'}           (auth: user JWT) -> { connected, email }
 *   POST {action:'send', to,subject,body,leadId?} (auth: user JWT) -> { ok, id }
 *
 * Tokens live in email_accounts (RLS: service-role only). We request the gmail.send scope only,
 * plus openid+email so we can record which address was connected. Deploy with --no-verify-jwt: the
 * Google callback carries no Supabase JWT, so JWT checks are done manually per action.
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const CLIENT_ID = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') ?? ''
const CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') ?? ''
const STATE_SECRET = Deno.env.get('OAUTH_STATE_SECRET') ?? ''
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/gmail`
const SCOPES = 'openid email https://www.googleapis.com/auth/gmail.send'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })

function svcHeaders(extra: Record<string, string> = {}) {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...extra }
}

// --- auth: resolve the calling user from their Supabase JWT ---
async function getUser(req: Request): Promise<{ id: string; email: string } | null> {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return null
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: auth } })
  if (!res.ok) return null
  const u = await res.json()
  return u?.id ? { id: u.id, email: u.email ?? '' } : null
}

// --- signed state (binds the OAuth round-trip to a user; 10-min TTL) ---
const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'))
async function hmacHex(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(STATE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
async function makeState(userId: string): Promise<string> {
  const payload = b64url(`${userId}|${Date.now()}`)
  return `${payload}.${await hmacHex(payload)}`
}
async function readState(state: string): Promise<string | null> {
  const [payload, sig] = state.split('.')
  if (!payload || !sig || (await hmacHex(payload)) !== sig) return null
  const [userId, ts] = unb64url(payload).split('|')
  if (!userId || Date.now() - Number(ts) > 600_000) return null
  return userId
}

// --- Google token helpers ---
async function exchangeCode(code: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' }),
  })
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`)
  return await res.json() as { access_token: string; refresh_token?: string; expires_in: number; id_token?: string }
}
async function refreshAccessToken(refreshToken: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  })
  if (!res.ok) throw new Error(`token refresh failed: ${res.status} ${await res.text()}`)
  return await res.json() as { access_token: string; expires_in: number }
}
function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null
  try { return JSON.parse(unb64url(idToken.split('.')[1])).email ?? null } catch { return null }
}

interface Account { user_id: string; email: string | null; refresh_token: string; access_token: string | null; token_expiry: string | null }
async function loadAccount(userId: string): Promise<Account | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/email_accounts?user_id=eq.${userId}&select=*`, { headers: svcHeaders() })
  if (!res.ok) return null
  return (await res.json())[0] ?? null
}
async function validAccessToken(acc: Account): Promise<string> {
  const stillGood = acc.access_token && acc.token_expiry && new Date(acc.token_expiry).getTime() - Date.now() > 60_000
  if (stillGood) return acc.access_token!
  const t = await refreshAccessToken(acc.refresh_token)
  const expiry = new Date(Date.now() + t.expires_in * 1000).toISOString()
  await fetch(`${SUPABASE_URL}/rest/v1/email_accounts?user_id=eq.${acc.user_id}`, {
    method: 'PATCH', headers: svcHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ access_token: t.access_token, token_expiry: expiry, updated_at: new Date().toISOString() }),
  })
  return t.access_token
}

// --- build a base64url RFC-2822 message for the Gmail API ---
function buildRaw(from: string, to: string, subject: string, body: string): string {
  const enc = new TextEncoder()
  const utf8b64 = (s: string) => btoa(String.fromCharCode(...enc.encode(s)))
  const subj = /[^\x00-\x7F]/.test(subject) ? `=?UTF-8?B?${utf8b64(subject)}?=` : subject
  const bodyB64 = utf8b64(body).replace(/(.{76})/g, '$1\r\n')
  const msg = [
    `From: ${from}`, `To: ${to}`, `Subject: ${subj}`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64',
    '', bodyB64,
  ].join('\r\n')
  return btoa(String.fromCharCode(...enc.encode(msg))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = new URL(req.url)

  try {
    // --- Google OAuth callback (GET, no JWT) ---
    if (req.method === 'GET' && url.searchParams.has('code')) {
      const code = url.searchParams.get('code')!
      const state = url.searchParams.get('state') ?? ''
      const userId = await readState(state)
      if (!userId) return html('<p>Link expired or invalid. Close this window and try again.</p>', 400)
      const tok = await exchangeCode(code)
      const patch: Record<string, unknown> = {
        user_id: userId, email: emailFromIdToken(tok.id_token), access_token: tok.access_token,
        token_expiry: new Date(Date.now() + tok.expires_in * 1000).toISOString(), scopes: SCOPES, updated_at: new Date().toISOString(),
      }
      // refresh_token only comes back on first consent; keep the existing one on re-connect.
      if (tok.refresh_token) patch.refresh_token = tok.refresh_token
      await fetch(`${SUPABASE_URL}/rest/v1/email_accounts?on_conflict=user_id`, {
        method: 'POST', headers: svcHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(patch),
      })
      return html('<!doctype html><meta charset="utf-8"><title>Gmail connected</title><body style="font:16px system-ui;padding:2rem;text-align:center"><p>✅ Gmail connected. You can close this window.</p><script>try{window.opener&&window.opener.postMessage("gmail-connected","*")}catch(e){}setTimeout(function(){window.close()},800)</script></body>')
    }
    if (req.method === 'GET') return json({ ok: true, service: 'gmail' })

    // --- authenticated actions (POST + user JWT) ---
    const user = await getUser(req)
    if (!user) return json({ error: 'unauthorized' }, 401)
    const body = await req.json().catch(() => ({})) as Record<string, string>
    const action = body.action

    if (action === 'start') {
      if (!CLIENT_ID) return json({ error: 'Gmail is not configured yet (missing GOOGLE_OAUTH_CLIENT_ID).' }, 400)
      const params = new URLSearchParams({
        client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: SCOPES,
        access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
        login_hint: user.email, state: await makeState(user.id),
      })
      return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` })
    }

    if (action === 'status') {
      const acc = await loadAccount(user.id)
      return json({ connected: !!acc, email: acc?.email ?? null })
    }

    if (action === 'send') {
      const to = (body.to ?? '').trim(), subject = (body.subject ?? '').trim(), text = body.body ?? ''
      if (!to || !subject || !text.trim()) return json({ error: 'Missing recipient, subject, or message.' }, 400)
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ error: 'That recipient email looks invalid.' }, 400)
      const acc = await loadAccount(user.id)
      if (!acc) return json({ error: 'Gmail not connected.' }, 400)
      const accessToken = await validAccessToken(acc)
      const from = acc.email ?? user.email
      const raw = buildRaw(from, to, subject, text)
      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }),
      })
      if (!res.ok) return json({ error: `Gmail rejected the send: ${res.status} ${await res.text()}` }, 502)
      const sent = await res.json()
      return json({ ok: true, id: sent.id })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
