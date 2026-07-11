/**
 * send-email — send a follow-up from hamna@techxserve.com via Resend.
 *
 * The mailbox is Titan (GoDaddy) with login verification, so we can't authenticate SMTP as her.
 * Instead we send through Resend's HTTP API from a *verified domain* (techxserve.com): the email
 * still shows From hamna@techxserve.com, and replies land in her Titan inbox (MX unchanged).
 * The API key lives in secrets (RESEND_API_KEY), never in the DB or the browser. Only the
 * authorised sender (EMAIL_SENDER_USER_ID) may send.
 *
 * Actions (POST):
 *   {action:'status'}                              (user JWT)            -> { connected, email }
 *   {action:'send', to, subject, body, leadId?}    (user JWT)            -> { ok, id }
 *   {action:'test-send', secret, to?}              (admin: PIPELINE_SECRET) -> { ok, id }  [temporary]
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const PIPELINE_SECRET = Deno.env.get('PIPELINE_SECRET') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM_EMAIL = Deno.env.get('EMAIL_FROM') ?? 'hamna@techxserve.com'
const SENDER_NAME = Deno.env.get('EMAIL_SENDER_NAME') ?? 'Hamna'
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

async function sendMail(to: string, subject: string, body: string): Promise<string> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${SENDER_NAME} <${FROM_EMAIL}>`,
      to: [to],
      bcc: [FROM_EMAIL],   // keep a copy in her own inbox
      reply_to: FROM_EMAIL,
      subject,
      text: body,
    }),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Resend rejected the send: ${res.status} ${JSON.stringify(out)}`)
  return out.id ?? ''
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: true, service: 'send-email' })

  const auth = req.headers.get('Authorization') ?? ''
  const body = await req.json().catch(() => ({})) as Record<string, string>
  const action = body.action

  try {
    // TEMP admin test-send (removed after verification).
    if (action === 'test-send') {
      if (!PIPELINE_SECRET || body.secret !== PIPELINE_SECRET) return json({ error: 'forbidden' }, 403)
      if (!RESEND_API_KEY) return json({ error: 'RESEND_API_KEY not set' }, 400)
      const to = (body.to ?? FROM_EMAIL).trim()
      const id = await sendMail(to, body.subject ?? 'LeadIntel test email', body.body ?? 'Test send from LeadIntel via Resend — if you got this, sending works.')
      return json({ ok: true, id, sentTo: to })
    }

    const user = await getUser(auth)
    if (!user) return json({ error: 'unauthorized' }, 401)
    const configured = !!RESEND_API_KEY
    const allowed = user.id === ALLOWED_USER_ID

    if (action === 'status') {
      return json({ connected: configured && allowed, email: allowed && configured ? FROM_EMAIL : null })
    }

    if (action === 'send') {
      if (!allowed) return json({ error: 'You are not authorised to send from this mailbox.' }, 403)
      if (!configured) return json({ error: 'Email sending is not set up yet (missing RESEND_API_KEY).' }, 400)
      const to = (body.to ?? '').trim(), subject = (body.subject ?? '').trim(), text = body.body ?? ''
      if (!to || !subject || !text.trim()) return json({ error: 'Missing recipient, subject, or message.' }, 400)
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ error: 'That recipient email looks invalid.' }, 400)
      const id = await sendMail(to, subject, text)
      return json({ ok: true, id })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
