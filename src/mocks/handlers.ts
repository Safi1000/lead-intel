import { http, HttpResponse, delay } from 'msw'
import { DEFAULT_FLAGS } from '../config/featureFlags'
import type {
  Batch,
  BatchReport,
  CostSummary,
  EstimateResponse,
  ExportJob,
  LeadRow,
  NotificationPrefs,
  Paginated,
  ProfileSettings,
  Run,
  RunConfig,
} from '../api/types'
import {
  allRuns,
  batches,
  db,
  errorLog,
  findLead,
  findRun,
  mockAdmin,
  mockClient,
  mockUser,
  notifications,
  tickRuns,
  toLeadRow,
} from './data'
import type { ConfidenceStatus } from '../config/constants'

const ok = (data: unknown) => HttpResponse.json(data as object)
const fail = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status })

function paginate<T>(rows: T[], url: URL): Paginated<T> {
  const page = Number(url.searchParams.get('page') ?? 1)
  const pageSize = Number(url.searchParams.get('page_size') ?? 25)
  const start = (page - 1) * pageSize
  return {
    data: rows.slice(start, start + pageSize),
    page,
    page_size: pageSize,
    total: rows.length,
  }
}

// who is "logged in" depends on the demo credential used
let currentUser = mockUser

const profile: ProfileSettings = {
  name: mockUser.name,
  email: mockUser.email,
  timezone: mockUser.timezone,
  language: 'en',
}

let notificationPrefs: NotificationPrefs = {
  batch_ready: { email: true, whatsapp: false },
  hot_lead: { email: true, whatsapp: false },
  run_failed: { email: true, whatsapp: false },
  weekly_summary: { email: false, whatsapp: false },
}

const exportJobs: ExportJob[] = []

export const handlers = [
  // ---- Auth ----
  http.post('/api/auth/login', async ({ request }) => {
    await delay(400)
    const { email, password } = (await request.json()) as {
      email: string
      password: string
    }
    if (!password || password.length < 4)
      return fail(401, 'invalid_credentials', 'Invalid email or password.')
    currentUser = email.includes('admin') ? mockAdmin : mockUser
    return ok({ access_token: 'mock.jwt.token', refresh_token: 'mock.refresh', user: currentUser })
  }),
  http.post('/api/auth/refresh', () => ok({ access_token: 'mock.jwt.token.refreshed' })),
  http.post('/api/auth/logout', () => ok({})),
  http.post('/api/auth/forgot-password', async () => {
    await delay(300)
    return ok({})
  }),
  http.post('/api/auth/reset-password', async ({ request }) => {
    const { token } = (await request.json()) as { token: string; password: string }
    if (token === 'expired') return fail(400, 'token_expired', 'This reset link has expired.')
    return ok({})
  }),
  http.get('/api/auth/me', () =>
    ok({
      user: currentUser,
      client: mockClient,
      role: currentUser.role,
      feature_flags: DEFAULT_FLAGS,
      tos_accepted_at: currentUser.tos_accepted_at,
    }),
  ),
  http.post('/api/auth/accept-tos', () => {
    const at = new Date().toISOString()
    currentUser.tos_accepted_at = at
    return ok({ tos_accepted_at: at })
  }),

  // ---- Runs ----
  http.post('/api/runs/estimate', async ({ request }) => {
    await delay(600)
    const cfg = (await request.json()) as RunConfig
    const ownerPhone = cfg.options.include_owner_phone
    const estLeads = cfg.options.max_leads ?? 165
    const discovery = estLeads * 12
    const enrichment = estLeads * 55
    const phone = ownerPhone ? estLeads * 38 : 0
    const total = discovery + enrichment + phone
    const resp: EstimateResponse = {
      breakdown: [
        { label: 'Discovery (grid coverage)', cost_cents: discovery },
        { label: 'Enrichment (owner + contacts)', cost_cents: enrichment },
        ...(ownerPhone ? [{ label: 'Owner phone lookups', cost_cents: phone }] : []),
      ],
      total_cents: total,
      per_lead_cents: Math.round(total / estLeads),
      est_leads: estLeads,
      est_eta_seconds: 3600 + estLeads * 6,
    }
    return ok(resp)
  }),
  http.post('/api/runs', async ({ request }) => {
    await delay(500)
    const cfg = (await request.json()) as RunConfig
    const label = cfg.locations.city ?? (cfg.locations.zips?.join(', ') || 'Selected area')
    const run: Run = {
      ...db.runs[1],
      id: `run_${Math.random().toString(36).slice(2, 9)}`,
      trade: cfg.trade,
      location_label: label,
      status: 'queued',
      progress: 0,
      leads_found: 0,
      leads_enriched: 0,
      created_at: new Date().toISOString(),
      started_by: currentUser.name,
      fill_rate: null,
      cost_cents: 0,
    }
    ;(db.runs as Run[]).unshift({ ...run, leads: [] } as Run & { leads: [] })
    return ok({ run })
  }),
  http.get('/api/runs', ({ request }) => {
    const url = new URL(request.url)
    let rows: Run[] = db.runs
    const status = url.searchParams.get('status')
    const search = url.searchParams.get('search')?.toLowerCase()
    if (status) rows = rows.filter((r) => r.status === status)
    if (search) rows = rows.filter((r) => r.location_label.toLowerCase().includes(search))
    return ok(paginate(rows, url))
  }),
  http.get('/api/runs/:id', ({ params }) => {
    tickRuns()
    const run = findRun(params.id as string)
    return run ? ok(run) : fail(404, 'not_found', 'Run not found.')
  }),
  http.post('/api/runs/:id/cancel', ({ params }) => {
    const run = findRun(params.id as string)
    if (!run) return fail(404, 'not_found', 'Run not found.')
    run.status = 'failed'
    run.error_reason = 'Cancelled by user.'
    run.eta_seconds = null
    return ok(run)
  }),
  http.post('/api/runs/:id/rerun', async ({ params }) => {
    await delay(400)
    const run = findRun(params.id as string)
    if (!run) return fail(404, 'not_found', 'Run not found.')
    const fresh: Run = {
      ...run,
      id: `run_${Math.random().toString(36).slice(2, 9)}`,
      status: 'queued',
      progress: 0,
      leads_found: 0,
      leads_enriched: 0,
      created_at: new Date().toISOString(),
      error_reason: null,
    }
    ;(db.runs as Run[]).unshift({ ...fresh, leads: [] } as Run & { leads: [] })
    return ok({ run: fresh })
  }),

  // ---- Leads ----
  http.get('/api/runs/:id/leads', ({ params, request }) => {
    tickRuns()
    const run = findRun(params.id as string)
    if (!run) return fail(404, 'not_found', 'Run not found.')
    const url = new URL(request.url)
    let rows: LeadRow[] = run.leads.map(toLeadRow)
    const search = url.searchParams.get('search')?.toLowerCase()
    if (search)
      rows = rows.filter(
        (r) =>
          r.business_name.toLowerCase().includes(search) ||
          (r.owner_name.value ?? '').toLowerCase().includes(search),
      )
    if (url.searchParams.get('has_owner_phone') === 'true')
      rows = rows.filter((r) => r.owner_phone.status === 'present')
    if (url.searchParams.get('has_email') === 'true')
      rows = rows.filter((r) => r.email.status === 'present')
    const conf = url.searchParams.get('confidence')
    if (conf) rows = rows.filter((r) => r.row_confidence === conf)
    const sort = url.searchParams.get('sort')
    if (sort === 'business_name')
      rows = [...rows].sort((a, b) => a.business_name.localeCompare(b.business_name))
    const pageSize = Number(url.searchParams.get('page_size') ?? 100)
    const page = Number(url.searchParams.get('page') ?? 1)
    return ok({
      data: rows.slice((page - 1) * pageSize, page * pageSize),
      page,
      page_size: pageSize,
      total: rows.length,
    })
  }),
  http.get('/api/leads/:id', ({ params }) => {
    const lead = findLead(params.id as string)
    return lead ? ok(lead) : fail(404, 'not_found', 'Lead not found.')
  }),
  http.patch('/api/leads/:id', async ({ params, request }) => {
    const lead = findLead(params.id as string)
    if (!lead) return fail(404, 'not_found', 'Lead not found.')
    const body = (await request.json()) as { notes?: string; tags?: string[] }
    if (body.notes !== undefined) lead.notes = body.notes
    if (body.tags !== undefined) lead.tags = body.tags
    return ok(lead)
  }),

  // ---- Batches / reports ----
  http.get('/api/batches', ({ request }) => ok(paginate<Batch>(batches, new URL(request.url)))),
  http.get('/api/batches/:id/report', ({ params }) => {
    const batch = batches.find((b) => b.id === params.id)
    if (!batch) return fail(404, 'not_found', 'Batch not found.')
    const run = findRun(batch.run_id)
    const fr = run?.fill_rate
    const dist: Record<ConfidenceStatus, number> = {
      verified: 0,
      probable: 0,
      unverified: 0,
      missing: 0,
    }
    run?.leads.forEach((l) => {
      ;[l.owner_phone, l.email, l.business_phone, l.owner_name].forEach((f) => {
        dist[f.confidence]++
      })
    })
    const report: BatchReport = {
      batch,
      per_field: fr
        ? [
            { field: 'Business phone', fill: fr.business_phone },
            { field: 'Owner phone', fill: fr.owner_phone },
            { field: 'Email', fill: fr.business_email },
            { field: 'Website', fill: fr.website },
            { field: 'Social', fill: fr.social },
            { field: 'Ads', fill: fr.ads },
          ]
        : [],
      confidence_distribution: dist,
      cost_cents: run?.cost_cents ?? null,
    }
    return ok(report)
  }),

  // ---- Exports ----
  http.get('/api/exports', ({ request }) => ok(paginate(exportJobs, new URL(request.url)))),
  http.post('/api/exports', async ({ request }) => {
    const body = (await request.json()) as { format: 'csv' | 'xlsx'; run_id?: string; batch_id?: string }
    const job: ExportJob = {
      id: `exp_${Math.random().toString(36).slice(2, 8)}`,
      status: 'processing',
      format: body.format,
      download_url: null,
      created_at: new Date().toISOString(),
      row_count: 150,
      label: body.run_id ? `Run ${body.run_id.slice(-4)}` : `Batch ${body.batch_id?.slice(-4)}`,
    }
    exportJobs.unshift(job)
    // mark ready after a short delay (simulated async job)
    setTimeout(() => {
      job.status = 'ready'
      job.download_url = `data:text/csv;charset=utf-8,${encodeURIComponent(buildCsv(body.run_id))}`
    }, 1500)
    return ok(job)
  }),
  http.get('/api/exports/:id', ({ params }) => {
    const job = exportJobs.find((j) => j.id === params.id)
    return job ? ok(job) : fail(404, 'not_found', 'Export not found.')
  }),

  // ---- Settings ----
  http.get('/api/settings/profile', () => ok(profile)),
  http.patch('/api/settings/profile', async ({ request }) => {
    Object.assign(profile, (await request.json()) as Partial<ProfileSettings>)
    return ok(profile)
  }),
  http.post('/api/settings/profile/password', async ({ request }) => {
    const { current } = (await request.json()) as { current: string; next: string }
    if (!current) return fail(400, 'invalid', 'Current password is required.')
    return ok({})
  }),
  http.get('/api/settings/notifications', () => ok(notificationPrefs)),
  http.patch('/api/settings/notifications', async ({ request }) => {
    notificationPrefs = (await request.json()) as NotificationPrefs
    return ok(notificationPrefs)
  }),

  // ---- Notifications ----
  http.get('/api/notifications', ({ request }) =>
    ok(paginate(notifications, new URL(request.url))),
  ),
  http.post('/api/notifications/:id/read', ({ params }) => {
    const n = notifications.find((x) => x.id === params.id)
    if (n) n.read = true
    return ok({})
  }),

  // ---- Admin ----
  http.get('/api/admin/runs', ({ request }) => {
    tickRuns()
    const url = new URL(request.url)
    let rows: Run[] = allRuns()
    const status = url.searchParams.get('status')
    if (status) rows = rows.filter((r) => r.status === status)
    return ok(paginate(rows, url))
  }),
  http.get('/api/admin/runs/:id', ({ params }) => {
    tickRuns()
    const run = findRun(params.id as string)
    return run ? ok(run) : fail(404, 'not_found', 'Run not found.')
  }),
  http.post('/api/admin/runs/:id/override', async ({ params, request }) => {
    const run = findRun(params.id as string)
    if (!run) return fail(404, 'not_found', 'Run not found.')
    const { action } = (await request.json()) as { action: string; reason: string }
    if (action === 'pause') run.status = 'paused'
    if (action === 'resume') run.status = 'running'
    if (action === 'cancel') {
      run.status = 'failed'
      run.error_reason = 'Cancelled by admin.'
    }
    return ok(run)
  }),
  http.get('/api/admin/costs', ({ request }) => {
    const groupBy = new URL(request.url).searchParams.get('group_by') ?? 'run'
    const runs = allRuns()
    const rows =
      groupBy === 'client'
        ? Object.values(
            runs.reduce<Record<string, CostSummary['rows'][number]>>((acc, r) => {
              const key = r.client_name ?? 'Unknown'
              acc[key] ??= { group: key, label: key, api_breakdown: [], total_cents: 0 }
              acc[key].total_cents += r.cost_cents ?? 0
              return acc
            }, {}),
          )
        : runs.map((r) => ({
            group: r.id,
            label: `${r.client_name} · ${r.location_label}`,
            api_breakdown: [
              { api: 'Places', cost_cents: Math.round((r.cost_cents ?? 0) * 0.15), calls: 120 },
              { api: 'SkipTrace', cost_cents: Math.round((r.cost_cents ?? 0) * 0.4), calls: 80 },
              { api: 'Email verify', cost_cents: Math.round((r.cost_cents ?? 0) * 0.2), calls: 200 },
              { api: 'LLM', cost_cents: Math.round((r.cost_cents ?? 0) * 0.25), calls: 60 },
            ],
            total_cents: r.cost_cents ?? 0,
          }))
    const monthly = rows.reduce((s, r) => s + r.total_cents, 0)
    const summary: CostSummary = {
      rows,
      monthly_total_cents: monthly,
      monthly_ceiling_cents: 500000,
      near_cap: [{ api: 'SkipTrace', pct: 0.78 }],
    }
    return ok(summary)
  }),
  http.get('/api/admin/errors', ({ request }) =>
    ok(paginate(errorLog, new URL(request.url))),
  ),
]

function buildCsv(runId?: string): string {
  const run = runId ? findRun(runId) : db.runs.find((r) => r.leads.length)
  const header = 'Business,Owner,Owner Phone,Email,Confidence'
  const lines = (run?.leads ?? []).map((l) =>
    [
      l.business_name,
      l.owner_name.value ?? '',
      l.owner_phone.value ?? '',
      l.email.value ?? '',
      l.row_confidence,
    ].join(','),
  )
  return [header, ...lines].join('\n')
}
