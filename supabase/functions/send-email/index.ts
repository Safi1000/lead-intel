/**
 * send-email — send a follow-up from the user's real mailbox over SMTP.
 *
 * hamna@techxserve.com is Titan Email (GoDaddy), not Gmail — so we submit through Titan's SMTP
 * server rather than any provider API. Credentials live in secrets (SMTP_USER / SMTP_PASS), never
 * in the DB or the browser. Only the one authorised sender (EMAIL_SENDER_USER_ID) may send.
 *
 * Actions (POST, user JWT):
 *   {action:'status'}                              -> { connected, email }
 *   {action:'send', to, subject, body, leadId?}    -> { ok }
 *   {action:'probe'}   (admin: service-key bearer) -> { ok, reached }   TCP egress check
 */
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const PIPELINE_SECRET = Deno.env.get('PIPELINE_SECRET') ?? ''
const SMTP_HOST = Deno.env.get('SMTP_HOST') ?? 'smtp.titan.email'
const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') ?? '465')
const SMTP_USER = Deno.env.get('SMTP_USER') ?? ''
const SMTP_PASS = Deno.env.get('SMTP_PASS') ?? ''
const SENDER_NAME = Deno.env.get('SMTP_SENDER_NAME') ?? 'Hamna'
// Only this user may send (mailbox owner). Defaults to Hamna's profile id.
const ALLOWED_USER_ID = Deno.env.get('EMAIL_SENDER_USER_ID') ?? '0e94a8ed-f960-468e-9e2e-ec782f9797ae'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

async function getUser(auth: string): Promise<{ id: string; email: string } | null> {
  if (!auth.startsWith('Bearer ')) return null
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: auth } })
  if (!res.ok) return null
  const u = await res.json()
  return u?.id ? { id: u.id, email: u.email ?? '' } : null
}

async function sendMail(to: string, subject: string, body: string) {
  const client = new SMTPClient({
    connection: { hostname: SMTP_HOST, port: SMTP_PORT, tls: SMTP_PORT === 465, auth: { username: SMTP_USER, password: SMTP_PASS } },
  })
  try {
    await client.send({ from: `${SENDER_NAME} <${SMTP_USER}>`, to, subject, content: body })
  } finally {
    await client.close()
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: true, service: 'send-email' })

  const auth = req.headers.get('Authorization') ?? ''
  const body = await req.json().catch(() => ({})) as Record<string, string>
  const action = body.action

  try {
    // Admin connectivity probe — proves the edge runtime can open TCP to Titan's SMTP host.
    // Secret is passed in the body (the Authorization header is reserved for the gateway's JWT check).
    if (action === 'probe') {
      if (!PIPELINE_SECRET || body.secret !== PIPELINE_SECRET) return json({ error: 'forbidden' }, 403)
      try {
        const conn = await Deno.connect({ hostname: SMTP_HOST, port: SMTP_PORT })
        conn.close()
        return json({ ok: true, reached: `${SMTP_HOST}:${SMTP_PORT}` })
      } catch (e) { return json({ ok: false, error: String(e) }, 502) }
    }

    const user = await getUser(auth)
    if (!user) return json({ error: 'unauthorized' }, 401)
    const configured = !!SMTP_USER && !!SMTP_PASS
    const allowed = user.id === ALLOWED_USER_ID

    if (action === 'status') {
      return json({ connected: configured && allowed, email: allowed && configured ? SMTP_USER : null })
    }

    if (action === 'send') {
      if (!allowed) return json({ error: 'You are not authorised to send from this mailbox.' }, 403)
      if (!configured) return json({ error: 'Email sending is not set up yet (missing SMTP credentials).' }, 400)
      const to = (body.to ?? '').trim(), subject = (body.subject ?? '').trim(), text = body.body ?? ''
      if (!to || !subject || !text.trim()) return json({ error: 'Missing recipient, subject, or message.' }, 400)
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ error: 'That recipient email looks invalid.' }, 400)
      await sendMail(to, subject, text)
      return json({ ok: true })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
