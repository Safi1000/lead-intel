import { http, HttpResponse, delay } from 'msw'
import type {
  AdminClient,
  AIProviderConfig,
  ApiKey,
  AuditEntry,
  BillingState,
  Campaign,
  Conversation,
  ChatMessage,
  Integration,
  MarketLock,
  SubClient,
  TeamMember,
  Trade,
  WaTemplate,
  Webhook,
} from '../api/types'
import { db, findLead, mockClient, toLeadRow } from './data'

const ok = (data: unknown) => HttpResponse.json(data as object)
const list = <T>(rows: T[]) => HttpResponse.json({ data: rows, page: 1, page_size: rows.length, total: rows.length })

let rid = 7000
const nid = (p: string) => `${p}_${(rid++).toString(36)}`

// ---- Trades ----
const TRADES: Trade[] = [
  { id: 'roofing', label: 'Roofing', enabled: true, icon: 'Home', signal_hint: 'Storm-season ad spikes', expected_fill: 0.72 },
  { id: 'hvac', label: 'HVAC', enabled: true, icon: 'Wind', signal_hint: 'Seasonal demand swings', expected_fill: 0.68 },
  { id: 'plumbing', label: 'Plumbing', enabled: true, icon: 'Wrench', signal_hint: 'Emergency-search intent', expected_fill: 0.7 },
  { id: 'electrical', label: 'Electrical', enabled: true, icon: 'Zap', signal_hint: 'Permit-driven activity', expected_fill: 0.66 },
  { id: 'landscaping', label: 'Landscaping', enabled: true, icon: 'Trees', signal_hint: 'Spring/summer cycles', expected_fill: 0.64 },
  { id: 'painting', label: 'Painting', enabled: true, icon: 'Paintbrush', signal_hint: 'Low digital footprint', expected_fill: 0.6 },
]

// ---- Team ----
const team: TeamMember[] = [
  { id: 'usr_owner', name: 'Hayan Saif', email: 'demo@techexcel.io', role: 'client_owner', status: 'active', last_active: new Date().toISOString() },
  { id: 'tm_2', name: 'Jordan Lee', email: 'jordan@acme.io', role: 'client_admin', status: 'active', last_active: null },
  { id: 'tm_3', name: 'Sam Rivera', email: 'sam@acme.io', role: 'client_member', status: 'active', last_active: null },
  { id: 'tm_4', name: 'Pat Morgan', email: 'pat@acme.io', role: 'client_billing', status: 'invited', last_active: null },
]

// ---- Billing ----
let billing: BillingState = {
  plan: 'Growth',
  tier: 'growth',
  currency: 'USD',
  balance_credits: 4200,
  included_credits: 6000,
  used_credits: 1800,
  payment_methods: [{ id: 'pm_1', brand: 'Visa', last4: '4242', exp: '08/27', default: true }],
  invoices: [
    { id: 'in_1', number: 'INV-2026-006', date: '2026-06-01', amount_cents: 49900, status: 'paid' },
    { id: 'in_2', number: 'INV-2026-005', date: '2026-05-01', amount_cents: 49900, status: 'paid' },
    { id: 'in_3', number: 'INV-2026-004', date: '2026-04-01', amount_cents: 49900, status: 'paid' },
  ],
  tiers: [
    { id: 'starter', name: 'Starter', price_cents: 19900, included_credits: 2000, features: ['1 trade', 'CSV export', 'Email support'] },
    { id: 'growth', name: 'Growth', price_cents: 49900, included_credits: 6000, features: ['All trades', 'AI scoring', 'CRM integrations', 'WhatsApp'], current: true },
    { id: 'scale', name: 'Scale', price_cents: 99900, included_credits: 15000, features: ['Everything in Growth', 'API access', 'Market locks', 'White-label'] },
  ],
}

// ---- Market locks ----
const locks: MarketLock[] = [
  { id: 'lock_1', trade: 'roofing', area: 'Austin, TX', expires_at: '2026-09-17', auto_renew: true },
  { id: 'lock_2', trade: 'roofing', area: 'Dallas, TX', expires_at: '2026-08-01', auto_renew: false },
]

// ---- Integrations ----
const integrations: Integration[] = [
  { provider: 'google-sheets', status: 'connected', account_name: 'acme@gmail.com', connected_at: '2026-05-20T10:00:00Z' },
  { provider: 'hubspot', status: 'disconnected' },
  { provider: 'gohighlevel', status: 'disconnected' },
  { provider: 'zapier', status: 'connected', account_name: 'Acme Zap', connected_at: '2026-05-01T10:00:00Z' },
  { provider: 'salesforce', status: 'disconnected' },
  { provider: 'pipedrive', status: 'disconnected' },
  { provider: 'keap', status: 'disconnected' },
  { provider: 'zoho', status: 'disconnected' },
  { provider: 'whatsapp', status: 'connected', account_name: '+1 (512) 555-0190', connected_at: '2026-06-01T10:00:00Z' },
]

// ---- Webhooks ----
const webhooks: Webhook[] = [
  { id: 'wh_1', url: 'https://api.acme.io/hooks/leadintel', events: ['batch.completed', 'run.failed'], enabled: true, secret: 'whsec_demo_8a2f', last_delivery: { status: 200, at: '2026-06-17T16:00:00Z' } },
]

// ---- API keys ----
const apiKeys: ApiKey[] = [
  { id: 'key_1', name: 'Production', masked: 'li_live_••••8f3a', scopes: ['runs:read', 'leads:read'], rate_limit: 600, created_at: '2026-04-10T10:00:00Z', last_used: '2026-06-17T15:00:00Z' },
]

// ---- AI providers ----
let aiConfig: AIProviderConfig = {
  assignments: { scoring: 'claude-opus-4-8', copy: 'claude-opus-4-8', summary: 'gpt-4o' },
  byo_keys: { 'claude-opus-4-8': { present: true, valid: true }, 'gpt-4o': { present: false, valid: false } },
  batch_open_source: false,
}

// ---- Campaigns / templates / inbox ----
const templates: WaTemplate[] = [
  { id: 'tpl_1', name: 'intro_offer', category: 'Marketing', language: 'en_US', body: 'Hi {{1}}, we help {{2}} businesses get more local leads. Open to a quick chat?', status: 'approved' },
  { id: 'tpl_2', name: 'followup_value', category: 'Marketing', language: 'en_US', body: 'Hi {{1}}, following up — noticed {{2}}. Worth a look?', status: 'pending' },
]
const campaigns: Campaign[] = [
  { id: 'camp_1', name: 'Austin roofers — June', template: 'intro_offer', audience_size: 120, status: 'sent', delivered: 118, read: 76, replied: 22, created_at: '2026-06-10T10:00:00Z' },
  { id: 'camp_2', name: 'Dallas warm leads', template: 'followup_value', audience_size: 64, status: 'sending', delivered: 40, read: 18, replied: 5, created_at: '2026-06-16T10:00:00Z' },
]
const conversations: Conversation[] = [
  { id: 'conv_1', lead_id: db.runs[2]?.leads[0]?.id ?? 'x', business_name: 'Summit Roofing Co 1', last_message: 'Sure, what do you have in mind?', unread: 2, updated_at: '2026-06-17T17:30:00Z', assignee: null, resolved: false },
  { id: 'conv_2', lead_id: db.runs[2]?.leads[1]?.id ?? 'y', business_name: 'Lone Star Roofers 2', last_message: 'Not interested, thanks.', unread: 0, updated_at: '2026-06-17T12:00:00Z', assignee: 'Jordan Lee', resolved: true },
]
const messages: Record<string, ChatMessage[]> = {
  conv_1: [
    { id: 'm1', direction: 'out', text: 'Hi! We help roofers in Austin get owner-level leads. Open to a quick chat?', at: '2026-06-17T16:00:00Z', status: 'read' },
    { id: 'm2', direction: 'in', text: 'Sure, what do you have in mind?', at: '2026-06-17T17:30:00Z' },
  ],
  conv_2: [{ id: 'm3', direction: 'in', text: 'Not interested, thanks.', at: '2026-06-17T12:00:00Z' }],
}

// ---- Reseller ----
const subClients: SubClient[] = [
  { id: 'sub_1', name: 'BrightLeads Agency', plan: 'Growth', leads_delivered: 1240, fill: 0.71, status: 'active' },
  { id: 'sub_2', name: 'Peak Marketing', plan: 'Scale', leads_delivered: 3180, fill: 0.69, status: 'active' },
  { id: 'sub_3', name: 'Volt Digital', plan: 'Starter', leads_delivered: 410, fill: 0.58, status: 'suspended' },
]

// ---- Admin clients / audit ----
const adminClients: AdminClient[] = [
  { id: 'cli_acme', name: 'Acme Roofing Leads', plan: 'Growth', status: 'active', leads_delivered: 5400, spend_cents: 1240000, created_at: '2026-01-10', retention_days: null },
  { id: 'cli_bright', name: 'BrightLeads Agency', plan: 'Growth', status: 'active', leads_delivered: 1240, spend_cents: 320000, created_at: '2026-03-01', retention_days: null },
  { id: 'cli_volt', name: 'Volt Digital', plan: 'Starter', status: 'deleting', leads_delivered: 410, spend_cents: 88000, created_at: '2026-04-15', retention_days: 23 },
]
const audit: AuditEntry[] = [
  { id: 'a1', at: '2026-06-17T16:00:00Z', actor: 'TechExcel Ops', action: 'run.override.cancel', resource: 'run_x91', client: 'Volt Digital', reason: 'Runaway cost — API 429 loop' },
  { id: 'a2', at: '2026-06-17T12:00:00Z', actor: 'TechExcel Ops', action: 'client.impersonate', resource: 'cli_bright', client: 'BrightLeads Agency', reason: 'Support ticket #4821' },
  { id: 'a3', at: '2026-06-16T09:00:00Z', actor: 'Hayan Saif', action: 'export.create', resource: 'bat_0', client: 'Acme Roofing Leads', reason: null },
]

function leadName(id: string) {
  return findLead(id)?.business_name ?? 'this business'
}

export const p2p3Handlers = [
  http.get('/api/trades', () => ok(TRADES)),

  // Team
  http.get('/api/team', () => ok(team)),
  http.post('/api/team/invites', async ({ request }) => {
    const b = (await request.json()) as { email: string; role: string }
    const m: TeamMember = { id: nid('tm'), name: b.email.split('@')[0], email: b.email, role: b.role as TeamMember['role'], status: 'invited', last_active: null }
    team.push(m)
    return ok(m)
  }),
  http.post('/api/team/invites/:id/resend', () => ok({})),
  http.patch('/api/team/:id/role', async ({ params, request }) => {
    const b = (await request.json()) as { role: string }
    const m = team.find((t) => t.id === params.id)
    if (m) m.role = b.role as TeamMember['role']
    return ok(m ?? {})
  }),
  http.delete('/api/team/:id', ({ params }) => {
    const i = team.findIndex((t) => t.id === params.id)
    if (i >= 0) team.splice(i, 1)
    return ok({})
  }),

  // Billing
  http.get('/api/billing', () => ok(billing)),
  http.post('/api/billing/credits', async ({ request }) => {
    const b = (await request.json()) as { amount: number }
    await delay(700)
    billing = { ...billing, balance_credits: billing.balance_credits + b.amount }
    return ok(billing)
  }),
  http.post('/api/billing/subscription', async ({ request }) => {
    const b = (await request.json()) as { tier: string }
    billing = { ...billing, tier: b.tier, plan: b.tier[0].toUpperCase() + b.tier.slice(1), tiers: billing.tiers.map((t) => ({ ...t, current: t.id === b.tier })) }
    return ok(billing)
  }),

  // Market locks
  http.get('/api/market-locks', () => ok(locks)),
  http.get('/api/market-locks/availability', ({ request }) => {
    const area = new URL(request.url).searchParams.get('area') ?? ''
    const taken = locks.find((l) => l.area.toLowerCase() === area.toLowerCase())
    return ok(taken ? { available: false, price_cents: 0, locked_until: taken.expires_at, locked_by: 'Another client' } : { available: true, price_cents: 29900 })
  }),
  http.post('/api/market-locks', async ({ request }) => {
    const b = (await request.json()) as { trade: string; area: string }
    const lock: MarketLock = { id: nid('lock'), trade: b.trade, area: b.area, expires_at: '2026-12-31', auto_renew: true }
    locks.push(lock)
    return ok(lock)
  }),
  http.delete('/api/market-locks/:id', ({ params }) => {
    const i = locks.findIndex((l) => l.id === params.id)
    if (i >= 0) locks.splice(i, 1)
    return ok({})
  }),

  // Usage
  http.get('/api/usage', () => {
    const series = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-06-${String(i + 4).padStart(2, '0')}`,
      credits: 80 + Math.round(Math.sin(i) * 30 + i * 6),
      leads: 30 + Math.round(Math.cos(i) * 12 + i * 3),
      fill: 0.6 + (i % 5) * 0.03,
    }))
    return ok({
      series,
      total_credits: series.reduce((s, p) => s + p.credits, 0),
      total_leads: series.reduce((s, p) => s + p.leads, 0),
      by_trade: [
        { trade: 'Roofing', leads: 820, credits: 2100 },
        { trade: 'HVAC', leads: 240, credits: 720 },
        { trade: 'Plumbing', leads: 160, credits: 480 },
      ],
    })
  }),

  // Market map
  http.get('/api/market-map', () => {
    const zips = Array.from({ length: 40 }, (_, i) => {
      const covered = i % 3 !== 0
      return { zip: `7${(3700 + i).toString()}`.slice(0, 5), covered, leads: covered ? 10 + (i % 12) * 4 : 0, fill: covered ? 0.55 + (i % 5) * 0.05 : 0, locked: i % 11 === 0 }
    })
    return ok({ zips })
  }),

  // Integrations
  http.get('/api/integrations', () => ok(integrations)),
  http.post('/api/integrations/:provider/connect', async ({ params }) => {
    await delay(800)
    const it = integrations.find((i) => i.provider === params.provider)
    if (it) {
      it.status = 'connected'
      it.account_name = `${params.provider}-acme`
      it.connected_at = new Date().toISOString()
    }
    return ok(it ?? {})
  }),
  http.delete('/api/integrations/:provider', ({ params }) => {
    const it = integrations.find((i) => i.provider === params.provider)
    if (it) {
      it.status = 'disconnected'
      it.account_name = null
    }
    return ok(it ?? {})
  }),
  http.put('/api/integrations/:provider/mapping', () => ok({})),
  http.post('/api/integrations/:provider/test', async () => {
    await delay(600)
    return ok({ created: 3, updated: 1, skipped: 1 })
  }),

  // Webhooks
  http.get('/api/webhooks', () => ok(webhooks)),
  http.post('/api/webhooks', async ({ request }) => {
    const b = (await request.json()) as { url: string; events: string[] }
    const wh: Webhook = { id: nid('wh'), url: b.url, events: b.events, enabled: true, secret: `whsec_${Math.random().toString(36).slice(2, 10)}`, last_delivery: null }
    webhooks.push(wh)
    return ok(wh)
  }),
  http.put('/api/webhooks/:id', async ({ params, request }) => {
    const b = (await request.json()) as Partial<Webhook>
    const wh = webhooks.find((w) => w.id === params.id)
    if (wh) Object.assign(wh, b)
    return ok(wh ?? {})
  }),
  http.delete('/api/webhooks/:id', ({ params }) => {
    const i = webhooks.findIndex((w) => w.id === params.id)
    if (i >= 0) webhooks.splice(i, 1)
    return ok({})
  }),
  http.post('/api/webhooks/:id/test', async () => {
    await delay(500)
    return ok({ status: 200, body: '{"received":true}' })
  }),
  http.get('/api/webhooks/:id/deliveries', () =>
    ok([
      { id: 'd1', event: 'batch.completed', status: 200, at: '2026-06-17T16:00:00Z', duration_ms: 142 },
      { id: 'd2', event: 'run.failed', status: 500, at: '2026-06-16T10:00:00Z', duration_ms: 2310 },
      { id: 'd3', event: 'batch.completed', status: 200, at: '2026-06-15T10:00:00Z', duration_ms: 98 },
    ]),
  ),

  // API keys
  http.get('/api/settings/api-keys', () => ok(apiKeys)),
  http.post('/api/settings/api-keys', async ({ request }) => {
    const b = (await request.json()) as { name: string; scopes: string[]; rate_limit: number }
    const secret = `li_live_${Math.random().toString(36).slice(2, 18)}`
    const key: ApiKey = { id: nid('key'), name: b.name, masked: `li_live_••••${secret.slice(-4)}`, scopes: b.scopes, rate_limit: b.rate_limit, created_at: new Date().toISOString(), last_used: null }
    apiKeys.push(key)
    return ok({ key, secret })
  }),
  http.delete('/api/settings/api-keys/:id', ({ params }) => {
    const i = apiKeys.findIndex((k) => k.id === params.id)
    if (i >= 0) apiKeys.splice(i, 1)
    return ok({})
  }),
  http.get('/api/settings/api-keys/:id/usage', () =>
    ok({
      series: Array.from({ length: 14 }, (_, i) => ({ date: `2026-06-${String(i + 4).padStart(2, '0')}`, calls: 200 + i * 30, errors: i % 4 })),
      total_calls: 4820,
      total_429: 12,
    }),
  ),

  // AI providers
  http.get('/api/settings/ai-providers', () => ok(aiConfig)),
  http.put('/api/settings/ai-providers', async ({ request }) => {
    aiConfig = (await request.json()) as AIProviderConfig
    return ok(aiConfig)
  }),

  // AI generation
  http.post('/api/ai/outreach-angle/:leadId', async ({ params }) => {
    await delay(300)
    const name = leadName(params.leadId as string)
    return ok({ channel: 'note', tone: 'consultative', provider: aiConfig.assignments.copy, text: `${name} shows a weak digital footprint — no live website and minimal ad presence. Lead with a free local-visibility audit: "Most ${name.split(' ')[0]} customers can't find you online — I pulled a quick report on where you're losing roofing leads to competitors." This frames you as helpful, not salesy.` })
  }),
  http.post('/api/ai/outreach/:leadId', async ({ params, request }) => {
    await delay(300)
    const b = (await request.json()) as { channel: string; tone: string }
    const name = leadName(params.leadId as string)
    const tones: Record<string, string> = {
      direct: `Hi — I help ${name} win more local roofing jobs. You're missing an active web presence; I can fix that. 15 min this week?`,
      consultative: `Hi, I noticed ${name} doesn't show up for "roofers near me" searches — that's costing you owner-level leads. Happy to share a quick audit, no pitch.`,
      curiosity: `Quick question about ${name} — did you know 3 competitors in your zip are outranking you on Google with active ads? I mapped it out.`,
    }
    return ok({ channel: b.channel, tone: b.tone, provider: aiConfig.assignments.copy, text: tones[b.tone] ?? tones.consultative })
  }),
  http.post('/api/ai/sequence/:leadId', async ({ params }) => {
    await delay(300)
    const name = leadName(params.leadId as string)
    return ok({
      steps: [
        { channel: 'email', delay: 'Day 0', text: `Subject: Quick audit for ${name}\n\nHi — I pulled a local-visibility report for ${name}. You're invisible for several high-intent roofing searches. Want me to send it over?` },
        { channel: 'email', delay: 'Day 3', text: `Following up — the report shows 3 competitors capturing leads in your zip. Two-minute read, no obligation.` },
        { channel: 'whatsapp', delay: 'Day 6', text: `Hi, last nudge — happy to walk you through the ${name} visibility gaps on a 10-min call. Worth it?` },
      ],
    })
  }),
  http.get('/api/runs/:id/market-summary', async ({ params }) => {
    await delay(300)
    return ok({
      run_id: params.id,
      provider: aiConfig.assignments.summary,
      narrative: 'This market shows strong opportunity: 41% of roofing businesses have no live website and 58% run no active ads, indicating low digital sophistication and high receptiveness to lead-gen outreach. Owner-contactability is above the trade average. Prioritize the 22 "hot" businesses with absent online presence — they convert best to consultative outreach.',
      stats: [
        { label: '% no website', value: 41 },
        { label: '% no active ads', value: 58 },
        { label: '% owner phone found', value: 64 },
        { label: 'Hot leads', value: 22 },
      ],
    })
  }),
  http.get('/api/leads/:id/predictive', () =>
    ok({
      best_windows: [
        { day: 'Tue', window: '9–11am', confidence: 0.82 },
        { day: 'Thu', window: '2–4pm', confidence: 0.74 },
        { day: 'Sat', window: '10am–12pm', confidence: 0.61 },
      ],
      seasonal: 'Roofing outreach peaks late spring through early fall (storm season). Best to engage before June.',
    }),
  ),
  http.post('/api/ai/assistant/query', async () => {
    await delay(400)
    const leads = db.runs[2]?.leads.slice(0, 6).map(toLeadRow) ?? []
    return ok({ provider: aiConfig.assignments.summary, answer: `Based on your delivered data, I found ${leads.length} matching businesses. These roofers in Austin have a hot score and weak online presence — strong candidates for outreach. Open them as a filtered list to take action.`, table: leads })
  }),
  http.post('/api/ai/run-builder/parse', async ({ request }) => {
    await delay(400)
    const b = (await request.json()) as { text: string }
    const t = b.text.toLowerCase()
    const trade = TRADES.find((tr) => t.includes(tr.id))?.id ?? 'roofing'
    const cityMatch = b.text.match(/in ([A-Z][a-zA-Z]+(?:,? [A-Z]{2})?)/)
    return ok({ trade, city: cityMatch?.[1] ?? 'Austin, TX', include_owner_phone: t.includes('phone'), confidence: 0.9 })
  }),

  // Campaigns / templates / inbox
  // NOTE: static `/templates` routes MUST be registered before `/:id` so MSW
  // doesn't match "templates" as an :id (first matching handler wins).
  http.get('/api/campaigns', () => ok(campaigns)),
  http.get('/api/campaigns/templates', () => ok(templates)),
  http.post('/api/campaigns', async ({ request }) => {
    const b = (await request.json()) as { name: string; template: string }
    const c: Campaign = { id: nid('camp'), name: b.name, template: b.template, audience_size: 0, status: 'draft', delivered: 0, read: 0, replied: 0, created_at: new Date().toISOString() }
    campaigns.unshift(c)
    return ok(c)
  }),
  http.post('/api/campaigns/templates', async ({ request }) => {
    const b = (await request.json()) as { name: string; category: string; body: string }
    const t: WaTemplate = { id: nid('tpl'), name: b.name, category: b.category, language: 'en_US', body: b.body, status: 'pending' }
    templates.push(t)
    return ok(t)
  }),
  http.post('/api/campaigns/templates/:id/submit', ({ params }) => {
    const t = templates.find((x) => x.id === params.id)
    if (t) t.status = 'pending'
    return ok(t ?? {})
  }),
  // Dynamic :id last so it doesn't shadow /templates
  http.get('/api/campaigns/:id', ({ params }) => ok(campaigns.find((c) => c.id === params.id) ?? {})),
  http.get('/api/inbox', () => ok(conversations)),
  http.get('/api/inbox/:id', ({ params }) =>
    ok({ conversation: conversations.find((c) => c.id === params.id), messages: messages[params.id as string] ?? [] }),
  ),
  http.post('/api/inbox/:id/reply', async ({ params, request }) => {
    const b = (await request.json()) as { text: string }
    const msg: ChatMessage = { id: nid('m'), direction: 'out', text: b.text, at: new Date().toISOString(), status: 'sent' }
    ;(messages[params.id as string] ??= []).push(msg)
    const conv = conversations.find((c) => c.id === params.id)
    if (conv) {
      conv.last_message = b.text
      conv.unread = 0
    }
    return ok(msg)
  }),
  http.post('/api/inbox/:id/suggest-replies', async () => {
    await delay(400)
    return ok({ suggestions: ['Great! How does Thursday at 2pm work for a quick 10-minute call?', 'Happy to send over the free visibility audit first — what email works best?', 'Totally understand. Mind if I follow up next month before storm season?'] })
  }),

  // Reseller
  http.get('/api/reseller/sub-clients', () => ok(subClients)),
  http.post('/api/reseller/sub-clients', async ({ request }) => {
    const b = (await request.json()) as { name: string }
    const sc: SubClient = { id: nid('sub'), name: b.name, plan: 'Starter', leads_delivered: 0, fill: 0, status: 'active' }
    subClients.push(sc)
    return ok(sc)
  }),
  http.get('/api/reseller/revenue', () =>
    ok({
      commission_cents: 412000,
      pending_cents: 88000,
      statements: [
        { period: 'May 2026', amount_cents: 210000, status: 'paid' },
        { period: 'Jun 2026', amount_cents: 88000, status: 'pending' },
      ],
    }),
  ),

  // Admin extras
  http.get('/api/admin/clients', () => list(adminClients)),
  http.get('/api/admin/clients/:id', ({ params }) => ok(adminClients.find((c) => c.id === params.id) ?? adminClients[0])),
  http.post('/api/admin/clients/:id/suspend', ({ params }) => {
    const c = adminClients.find((x) => x.id === params.id)
    if (c) c.status = c.status === 'suspended' ? 'active' : 'suspended'
    return ok(c ?? {})
  }),
  http.get('/api/admin/audit', () => list(audit)),
  http.get('/api/admin/market-locks', () => list(locks.map((l) => ({ ...l, client_name: mockClient.name })))),
  http.post('/api/admin/market-locks/:id/release', ({ params }) => {
    const i = locks.findIndex((l) => l.id === params.id)
    if (i >= 0) locks.splice(i, 1)
    return ok({})
  }),
]
