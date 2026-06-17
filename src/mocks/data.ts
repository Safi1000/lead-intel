/** In-memory mock database (§17 — MSW). Stateful so runs "progress". */
import { RUN_STAGES, type ConfidenceStatus } from '../config/constants'
import type {
  Batch,
  Client,
  ErrorLogItem,
  FillRate,
  LeadDetail,
  LeadField,
  LeadRow,
  NotificationItem,
  Run,
  StageProgress,
  User,
} from '../api/types'

// --- tiny seeded RNG for stable-ish mock data ---
let seed = 1337
function rng() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}
function chance(p: number) {
  return rng() < p
}
function id(prefix: string) {
  return `${prefix}_${Math.floor(rng() * 1e9).toString(36)}`
}

const NOW = Date.parse('2026-06-17T18:00:00Z')
function ago(minutes: number) {
  return new Date(NOW - minutes * 60_000).toISOString()
}

export const mockUser: User = {
  id: 'usr_owner',
  name: 'Hayan Saif',
  email: 'demo@techexcel.io',
  role: 'client_owner',
  timezone: 'America/New_York',
  tos_accepted_at: ago(60 * 24 * 30),
}

export const mockAdmin: User = {
  id: 'usr_admin',
  name: 'TechExcel Ops',
  email: 'admin@techexcel.io',
  role: 'admin',
  timezone: 'America/New_York',
  tos_accepted_at: ago(60 * 24 * 90),
}

export const mockClient: Client = {
  id: 'cli_acme',
  name: 'Acme Roofing Leads',
  plan: 'growth',
  credits_remaining: 4200,
}

const CITIES = [
  'Austin, TX',
  'Dallas, TX',
  'Phoenix, AZ',
  'Tampa, FL',
  'Denver, CO',
  'Charlotte, NC',
]
const BUSINESS_NAMES = [
  'Summit Roofing Co',
  'Lone Star Roofers',
  'Apex Exteriors',
  'BlueSky Roofing',
  'Ironclad Roof Systems',
  'Heritage Roofing',
  'Patriot Roof & Solar',
  'Cornerstone Roofing',
  'Skyline Roof Pros',
  'Evergreen Roofing',
  'Redline Roofing',
  'Anchor Roof Co',
]
const OWNER_NAMES = [
  'Mike Dawson',
  'Carlos Reyes',
  'Jennifer Park',
  'Tom Whitfield',
  'Sarah Nguyen',
  'David Okafor',
  'Linda Castillo',
  'Greg Sullivan',
]

function field(
  value: string | null,
  confidence: ConfidenceStatus,
  source: string | null,
  url?: string,
  reason?: string,
): LeadField {
  if (value == null || confidence === 'missing') {
    return {
      value: null,
      source: null,
      confidence: 'missing',
      status: 'missing',
      reason: reason ?? 'No value found across enrichment sources.',
    }
  }
  return {
    value,
    source,
    source_url: url ?? null,
    confidence,
    status: 'present',
    checked_at: ago(120),
  }
}

const CONF_WEIGHTS: ConfidenceStatus[] = [
  'verified',
  'verified',
  'verified',
  'probable',
  'probable',
  'unverified',
  'missing',
]
function randConf(): ConfidenceStatus {
  return pick(CONF_WEIGHTS)
}

const CRITICAL_ORDER: ConfidenceStatus[] = [
  'verified',
  'probable',
  'unverified',
  'missing',
]
function worst(...cs: ConfidenceStatus[]): ConfidenceStatus {
  return cs.reduce((w, c) =>
    CRITICAL_ORDER.indexOf(c) > CRITICAL_ORDER.indexOf(w) ? c : w,
  )
}

function makeLead(runId: string, idx: number): LeadDetail {
  const business = `${pick(BUSINESS_NAMES)} ${idx + 1}`
  const ownerConf = randConf()
  const ownerPhoneConf = randConf()
  const emailConf = randConf()
  const bizPhoneConf = randConf()
  const ownerName = ownerConf === 'missing' ? null : pick(OWNER_NAMES)
  const phone = `(${200 + Math.floor(rng() * 700)}) ${100 + Math.floor(rng() * 800)}-${1000 + Math.floor(rng() * 8000)}`
  const socials = ['facebook', 'instagram', 'linkedin'].filter(() => chance(0.5))
  const websiteLive = chance(0.7) ? true : chance(0.5) ? false : null
  const row_confidence = worst(ownerPhoneConf, emailConf, bizPhoneConf)
  // Score: poor online presence (no live site, no ads) = higher value (hotter)
  const score = Math.min(
    100,
    Math.round(
      (websiteLive ? 18 : 60) +
        (socials.length ? 0 : 20) +
        (ownerPhoneConf === 'verified' ? 15 : 0) +
        rng() * 15,
    ),
  )

  return {
    id: `${runId}_lead_${idx}`,
    run_id: runId,
    business_name: business,
    owner_name: field(ownerName, ownerConf, 'Secretary of State', 'https://example.com/sos'),
    business_phone: field(
      bizPhoneConf === 'missing' ? null : phone,
      bizPhoneConf,
      'Google Business Profile',
      'https://maps.google.com',
    ),
    owner_phone: field(
      ownerPhoneConf === 'missing' ? null : phone,
      ownerPhoneConf,
      'Skip-trace lookup',
      undefined,
      'Owner phone requires paid lookup; not available for this record.',
    ),
    email: field(
      emailConf === 'missing' ? null : `info@${business.toLowerCase().replace(/[^a-z]/g, '')}.com`,
      emailConf,
      'Website scrape',
      'https://example.com',
    ),
    owner_email: field(
      chance(0.4) ? `${(ownerName ?? 'owner').split(' ')[0].toLowerCase()}@example.com` : null,
      randConf(),
      'Email pattern + verify',
    ),
    address: field(`${100 + idx} Main St`, 'verified', 'USPS'),
    zip: field(`7${1000 + Math.floor(rng() * 8999)}`.slice(0, 5), 'verified', 'USPS'),
    website: field(
      websiteLive ? `https://${business.toLowerCase().replace(/[^a-z]/g, '')}.com` : null,
      websiteLive ? 'verified' : 'missing',
      'Live HTTP check',
      `https://${business.toLowerCase().replace(/[^a-z]/g, '')}.com`,
    ),
    website_live: websiteLive,
    website_history: websiteLive ? 'Domain active since 2019' : null,
    wayback_url: 'https://web.archive.org/',
    ad_activity: chance(0.45) ? 'active' : 'none',
    ad_link: 'https://www.facebook.com/ads/library/',
    socials,
    score,
    hot: score >= 70,
    tags: idx % 5 === 0 ? ['priority'] : [],
    row_confidence,
    linkedin: field(
      chance(0.45) && ownerName ? `linkedin.com/in/${ownerName.split(' ')[0].toLowerCase()}` : null,
      randConf(),
      'LinkedIn match',
      'https://linkedin.com',
    ),
    tech_stack: ['WordPress', 'Calendly', 'HubSpot', 'Wix', 'Squarespace'].filter(() => chance(0.3)),
    sentiment: chance(0.7) ? { score: Math.round(rng() * 100), themes: ['responsive', 'pricing', 'quality'].filter(() => chance(0.5)) } : null,
    business_age: field(`${2 + Math.floor(rng() * 20)} years`, 'probable', 'Domain registration'),
    property: { roof_age: `${5 + Math.floor(rng() * 18)} yrs`, last_permit: '2023', storm_activity: pick(['Low', 'Moderate', 'High']) },
    competitors: BUSINESS_NAMES.slice(0, 3).map((n) => ({ name: n, rating: 3.5 + rng() * 1.5 })),
    domain_signals: { expiry: '2027-04', ssl: 'Valid', last_update: '2024-11' },
    marketing_signals: {
      posting_frequency: pick(['Weekly', 'Monthly', 'Rarely']),
      last_post_at: ago(Math.floor(rng() * 60) * 24 * 60),
      review_sentiment: pick(['Positive', 'Mixed', 'Sparse']),
    },
    ai_insight: null,
    notes: null,
    sources: [
      { field: 'Owner name', source: 'Secretary of State', source_url: 'https://example.com/sos', confidence: ownerConf },
      { field: 'Business phone', source: 'Google Business Profile', confidence: bizPhoneConf },
      { field: 'Owner phone', source: 'Skip-trace lookup', confidence: ownerPhoneConf },
      { field: 'Email', source: 'Website scrape', confidence: emailConf },
    ],
  }
}

function fillRateFor(leads: LeadDetail[]): FillRate {
  const n = leads.length || 1
  const ratio = (pred: (l: LeadDetail) => boolean) =>
    leads.filter(pred).length / n
  return {
    owner_email: ratio((l) => l.owner_email.status === 'present'),
    owner_phone: ratio((l) => l.owner_phone.status === 'present'),
    business_phone: ratio((l) => l.business_phone.status === 'present'),
    business_email: ratio((l) => l.email.status === 'present'),
    website: ratio((l) => l.website.status === 'present'),
    social: ratio((l) => l.socials.length > 0),
    ads: ratio((l) => l.ad_activity === 'active'),
    overall: ratio(
      (l) => l.owner_phone.status === 'present' || l.email.status === 'present',
    ),
  }
}

function stagesFor(status: Run['status'], progress: number): StageProgress[] {
  return RUN_STAGES.map((stage, i) => {
    const threshold = (i + 1) / RUN_STAGES.length
    let st: StageProgress['status'] = 'pending'
    if (status === 'completed') st = 'done'
    else if (status === 'failed' && i >= 3) st = i === 3 ? 'failed' : 'pending'
    else if (status === 'failed') st = 'done'
    else if (progress >= threshold) st = 'done'
    else if (progress >= threshold - 1 / RUN_STAGES.length) st = 'running'
    return {
      stage,
      status: st,
      pct: st === 'done' ? 100 : st === 'running' ? Math.round(rng() * 80) + 10 : 0,
    }
  })
}

interface RunRecord extends Run {
  leads: LeadDetail[]
}

function makeRun(opts: {
  status: Run['status']
  progress: number
  leadCount: number
  ageMin: number
  client?: string
}): RunRecord {
  const runId = id('run')
  const trade = 'roofing'
  const location = pick(CITIES)
  const leads = Array.from({ length: opts.leadCount }, (_, i) => makeLead(runId, i))
  const fill = opts.leadCount ? fillRateFor(leads) : null
  const terminal = ['completed', 'partial', 'failed'].includes(opts.status)
  return {
    id: runId,
    client_id: mockClient.id,
    client_name: opts.client ?? mockClient.name,
    trade,
    location_label: location,
    status: opts.status,
    progress: opts.status === 'completed' ? 1 : opts.progress,
    stages: stagesFor(opts.status, opts.progress),
    leads_found: opts.leadCount,
    leads_enriched: Math.round(opts.leadCount * opts.progress),
    eta_seconds: terminal ? null : Math.round((1 - opts.progress) * 3600),
    fill_rate: fill,
    cost_cents: opts.leadCount * (opts.status === 'failed' ? 40 : 95),
    created_at: ago(opts.ageMin),
    started_at: ago(opts.ageMin - 1),
    completed_at: terminal ? ago(opts.ageMin - 40) : null,
    started_by: mockUser.name,
    error_reason:
      opts.status === 'failed'
        ? 'Contact-discovery provider returned 429 (rate limited) repeatedly.'
        : null,
    failed_stages: opts.status === 'failed' ? ['Contact discovery'] : undefined,
    leads,
  }
}

// --- seed the database ---
export const db = {
  runs: [
    makeRun({ status: 'running', progress: 0.42, leadCount: 64, ageMin: 18 }),
    makeRun({ status: 'queued', progress: 0, leadCount: 0, ageMin: 4 }),
    makeRun({ status: 'completed', progress: 1, leadCount: 182, ageMin: 60 * 6 }),
    makeRun({ status: 'completed', progress: 1, leadCount: 147, ageMin: 60 * 30 }),
    makeRun({ status: 'partial', progress: 0.7, leadCount: 88, ageMin: 60 * 12 }),
    makeRun({ status: 'failed', progress: 0.55, leadCount: 31, ageMin: 60 * 20 }),
  ] as RunRecord[],
}

// extra cross-client runs for the admin view
export const adminRuns: RunRecord[] = [
  makeRun({ status: 'running', progress: 0.3, leadCount: 40, ageMin: 9, client: 'BrightLeads Agency' }),
  makeRun({ status: 'completed', progress: 1, leadCount: 210, ageMin: 200, client: 'Peak Marketing' }),
  makeRun({ status: 'failed', progress: 0.2, leadCount: 12, ageMin: 90, client: 'Volt Digital' }),
]

export function allRuns(): RunRecord[] {
  return [...db.runs, ...adminRuns]
}

/** Advance running/queued runs a little on each poll so progress feels live. */
export function tickRuns() {
  for (const run of allRuns()) {
    if (run.status === 'queued') {
      run.status = 'running'
      run.started_at = new Date().toISOString()
    } else if (run.status === 'running') {
      run.progress = Math.min(1, run.progress + 0.06 + rng() * 0.04)
      run.leads_enriched = Math.round(run.leads_found * run.progress) || Math.round(run.progress * 120)
      run.leads_found = Math.max(run.leads_found, run.leads_enriched)
      run.eta_seconds = Math.round((1 - run.progress) * 3000)
      run.stages = stagesFor('running', run.progress)
      if (run.progress >= 1) {
        run.status = 'completed'
        run.eta_seconds = null
        run.completed_at = new Date().toISOString()
        if (run.leads.length === 0) {
          run.leads = Array.from({ length: 120 }, (_, i) => makeLead(run.id, i))
          run.leads_found = run.leads.length
        }
        run.fill_rate = fillRateFor(run.leads)
        run.stages = stagesFor('completed', 1)
      }
    }
  }
}

export function findRun(runId: string): RunRecord | undefined {
  return allRuns().find((r) => r.id === runId)
}

export function findLead(leadId: string): LeadDetail | undefined {
  for (const run of allRuns()) {
    const lead = run.leads.find((l) => l.id === leadId)
    if (lead) return lead
  }
  return undefined
}

export function toLeadRow(l: LeadDetail): LeadRow {
  return {
    id: l.id,
    run_id: l.run_id,
    business_name: l.business_name,
    owner_name: l.owner_name,
    business_phone: l.business_phone,
    owner_phone: l.owner_phone,
    email: l.email,
    website_live: l.website_live,
    ad_activity: l.ad_activity,
    socials: l.socials,
    score: l.score,
    hot: l.hot,
    tags: l.tags,
    row_confidence: l.row_confidence,
  }
}

// --- batches derived from completed runs ---
export const batches: Batch[] = db.runs
  .filter((r) => r.status === 'completed' || r.status === 'partial')
  .map((r, i) => ({
    id: `bat_${i}`,
    run_id: r.id,
    trade: r.trade,
    location_label: r.location_label,
    lead_count: r.leads_found,
    fill_rate: r.fill_rate?.overall ?? 0,
    delivered_to: mockClient.name,
    delivered_at: r.completed_at ?? r.created_at,
    status: 'delivered',
    deduped_count: Math.floor(rng() * 20),
  }))

export const notifications: NotificationItem[] = [
  {
    id: 'ntf_1',
    type: 'batch_ready',
    title: 'Batch ready: Austin Roofing',
    body: '182 leads delivered with 71% fill rate.',
    created_at: ago(35),
    read: false,
    link: '/batches',
  },
  {
    id: 'ntf_2',
    type: 'hot_lead',
    title: '3 hot leads found',
    body: 'High-confidence owner contacts with low digital footprint.',
    created_at: ago(120),
    read: false,
    link: '/runs',
  },
  {
    id: 'ntf_3',
    type: 'run_failed',
    title: 'Run failed: Denver Roofing',
    body: 'Contact-discovery provider rate limited. Re-run available.',
    created_at: ago(60 * 20),
    read: true,
    link: '/runs',
  },
]

export const errorLog: ErrorLogItem[] = [
  {
    id: 'err_1',
    created_at: ago(22),
    run_id: db.runs[5]?.id ?? null,
    client_name: mockClient.name,
    source: 'SkipTrace API',
    message: 'HTTP 429 Too Many Requests — backoff exhausted after 5 retries.',
    severity: 'critical',
    resolved: false,
  },
  {
    id: 'err_2',
    created_at: ago(90),
    run_id: adminRuns[2]?.id ?? null,
    client_name: 'Volt Digital',
    source: 'Places API',
    message: 'Quota warning: 82% of daily discovery quota consumed.',
    severity: 'warning',
    resolved: false,
  },
  {
    id: 'err_3',
    created_at: ago(60 * 5),
    run_id: null,
    client_name: 'System',
    source: 'Email verifier',
    message: 'Transient timeout verifying 4 addresses; retried successfully.',
    severity: 'info',
    resolved: true,
  },
]
