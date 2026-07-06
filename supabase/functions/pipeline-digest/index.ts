/**
 * pipeline-digest — daily 6:00 PM (PKT) Slack summary of the day's auto-run.
 * Fired by pg_cron at 13:00 UTC. Rules:
 *   - Only when the org's daily auto-run is ENABLED (unticked = no digest that day).
 *   - Summarizes TODAY's date-named batches ("6th July - Monday, 2026 — Website / — No Website").
 *   - If the run is enabled but today's batch is missing, posts a warning instead (monitoring).
 * Posts via SLACK_WEBHOOK_URL secret; if unset, logs and exits gracefully.
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PIPELINE_SECRET = Deno.env.get('PIPELINE_SECRET') ?? ''
const SLACK_WEBHOOK_URL = Deno.env.get('SLACK_WEBHOOK_URL') ?? ''
// Low-privilege token for ?mode=data (read-only day summary JSON, consumed by the Claude routine).
// Deliberately separate from PIPELINE_SECRET so the routine prompt never holds a powerful secret.
const DIGEST_TOKEN = Deno.env.get('DIGEST_TOKEN') ?? ''

const TZ = 'Asia/Karachi'

function svcHeaders(extra: Record<string, string> = {}) {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...extra }
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

function todayBatchBaseName(): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, day: 'numeric', month: 'long', weekday: 'long', year: 'numeric' })
    .formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${ordinal(Number(get('day')))} ${get('month')} - ${get('weekday')}, ${get('year')}`
}

async function fetchAllRows<T>(pathQs: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathQs}`, {
      headers: svcHeaders({ 'Range-Unit': 'items', Range: `${from}-${from + 999}` }),
    })
    if (!res.ok) break
    const page = (await res.json()) as T[]
    out.push(...page)
    if (page.length < 1000) break
  }
  return out
}

// Cheap exact count via PostgREST Content-Range (no row payload).
async function countRows(pathQs: string): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathQs}`, {
    headers: svcHeaders({ Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' }),
  })
  const total = Number((res.headers.get('content-range') ?? '').split('/')[1])
  return Number.isFinite(total) ? total : 0
}

async function postSlack(text: string): Promise<boolean> {
  if (!SLACK_WEBHOOK_URL) { console.log('[digest] SLACK_WEBHOOK_URL unset — digest built but not sent:\n' + text); return false }
  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) console.error('[digest] slack post failed:', res.status, await res.text())
  return res.ok
}

interface LeadRow { display_name: string; data: Record<string, string> }

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const mode = url.searchParams.get('mode')
  const dataMode = mode === 'data'
  const auth = req.headers.get('Authorization') ?? ''
  const okSecret = PIPELINE_SECRET && auth === `Bearer ${PIPELINE_SECRET}`
  const okDigest = (mode === 'data' || mode === 'health') && DIGEST_TOKEN && auth === `Bearer ${DIGEST_TOKEN}`
  if (!okSecret && !okDigest) {
    return new Response('unauthorized', { status: 401 })
  }

  try {
    // Health mode: pipeline monitoring JSON for the owner's PRIVATE watchdog routine. Works even
    // when the daily auto-run is disabled (monitoring shouldn't depend on it).
    if (mode === 'health') {
      const cfgAll: Array<{ org_id: string; daily_run_enabled: boolean }> = await fetchAllRows('pipeline_config?select=org_id,daily_run_enabled')
      const orgId = cfgAll[0]?.org_id ?? ''
      const orgFilter = orgId ? `org_id=eq.${orgId}&` : ''
      const now = Date.now(), DAY = 86400000
      const isoAgo = (ms: number) => new Date(now - ms).toISOString()
      const pktDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
      const todayStr = pktDay(new Date().toISOString())

      const runsRes = await fetch(`${SUPABASE_URL}/rest/v1/pipeline_runs?${orgFilter}select=status,started_at,completed_at,processed_total,total_imported,error&order=started_at.desc&limit=40`, { headers: svcHeaders() })
      const runsRaw: Array<{ status: string; started_at: string; completed_at: string | null; processed_total: number | null; total_imported: number | null; error: string | null }> = runsRes.ok ? await runsRes.json() : []
      const recent_runs = runsRaw.slice(0, 12).map((r) => ({
        started_pkt: new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(r.started_at)),
        status: r.status,
        scanned: r.processed_total ?? 0,
        imported: r.total_imported ?? 0,
        qual_rate: r.processed_total ? Math.round(((r.total_imported ?? 0) / r.processed_total) * 1000) / 10 : null,
        error: r.error,
        is_today: pktDay(r.started_at) === todayStr,
      }))
      const scanned_30d = runsRaw.filter((r) => now - new Date(r.started_at).getTime() < 30 * DAY).reduce((s, r) => s + (r.processed_total ?? 0), 0)
      const leads_7d = await countRows(`leads?${orgFilter}created_at=gte.${isoAgo(7 * DAY)}&select=id`)
      const leads_30d = await countRows(`leads?${orgFilter}created_at=gte.${isoAgo(30 * DAY)}&select=id`)
      const ads_pending = await countRows('sourced_places?ads_task_id=not.is.null&runs_google_ads=is.null&crm_lead_id=not.is.null&select=place_id')
      const runs_running_over_2h = runsRaw.filter((r) => r.status === 'running' && now - new Date(r.started_at).getTime() > 2 * 3600000).length

      return new Response(JSON.stringify({
        mode: 'health',
        generated_at_pkt: new Intl.DateTimeFormat('en-US', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }).format(new Date()),
        today_pkt: todayBatchBaseName(),
        daily_run_enabled: cfgAll.some((c) => c.daily_run_enabled),
        recent_runs,
        throughput: { leads_7d, leads_30d, scanned_recent: scanned_30d },
        cost_est_usd_30d: Math.round(leads_30d * 0.02 * 100) / 100,
        stuck: { ads_pending, runs_running_over_2h },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    const cfgs: Array<{ org_id: string; daily_run_target: number; slack_webhook_url: string | null }> = await fetchAllRows(
      'pipeline_config?daily_run_enabled=eq.true&select=org_id,daily_run_target,slack_webhook_url')
    if (cfgs.length === 0) {
      return new Response(JSON.stringify(dataMode ? { skip: true, reason: 'daily run disabled' } : { ok: true, note: 'daily run disabled — no digest' }), { status: 200 })
    }

    // Data mode: return the day's raw material as JSON — the Claude routine does the thinking.
    if (dataMode) {
      const cfg = cfgs[0]
      const baseName = todayBatchBaseName()
      const batches: Array<{ id: string; file_name: string }> = await fetchAllRows(
        `batches?org_id=eq.${cfg.org_id}&file_name=like.${encodeURIComponent(baseName + '*')}&select=id,file_name`)
      const web = batches.find((b) => b.file_name.endsWith('— Website'))
      const nw = batches.find((b) => b.file_name.endsWith('— No Website'))
      if (!web && !nw) {
        return new Response(JSON.stringify({ skip: false, base_name: baseName, no_batch_today: true, target: cfg.daily_run_target, webhook: cfg.slack_webhook_url }), { status: 200 })
      }
      let run: Record<string, unknown> | null = null
      if (web) {
        const runs: Array<{ processed_total: number | null; total_imported: number | null; status: string; started_at: string; completed_at: string | null }> =
          await fetchAllRows(`pipeline_runs?batch_id=eq.${web.id}&select=processed_total,total_imported,status,started_at,completed_at&order=started_at`)
        const scanned = runs.reduce((s, r) => s + (r.processed_total ?? 0), 0)
        const minutes = Math.round(runs.reduce((s, r) => s + (r.completed_at ? (new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 60000 : 0), 0))
        run = { scanned, minutes, still_running: runs.some((r) => r.status === 'running'), runs: runs.length }
      }
      const leads: Array<{ batch: string; name: string; q: string; ads: string; pain: string; city: string; rating: string }> = []
      for (const b of [web, nw].filter(Boolean) as Array<{ id: string; file_name: string }>) {
        const rows = await fetchAllRows<LeadRow>(`leads?batch_id=eq.${b.id}&select=display_name,data`)
        for (const l of rows.slice(0, 600)) {
          leads.push({
            batch: b.file_name.endsWith('— No Website') ? 'no_website' : 'website',
            name: l.display_name,
            q: l.data?.['Quality Score'] ?? '',
            ads: l.data?.['Running Google Ads'] ?? '',
            pain: (l.data?.['Pain Points'] ?? '').slice(0, 400),
            city: l.data?.['Search Location'] ?? '',
            rating: l.data?.['Rating'] ?? '',
          })
        }
      }
      return new Response(JSON.stringify({
        skip: false, base_name: baseName, target: cfg.daily_run_target, webhook: cfg.slack_webhook_url,
        run, lead_count: leads.length, leads,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    const baseName = todayBatchBaseName()

    for (const cfg of cfgs) {
      // today's batches
      const batches: Array<{ id: string; file_name: string }> = await fetchAllRows(
        `batches?org_id=eq.${cfg.org_id}&file_name=like.${encodeURIComponent(baseName + '*')}&select=id,file_name`)
      const web = batches.find((b) => b.file_name.endsWith('— Website'))
      const nw = batches.find((b) => b.file_name.endsWith('— No Website'))

      if (!web && !nw) {
        await postSlack(`:warning: *LeadIntel daily run* — auto-run is enabled but *no batch was created today* ("${baseName}"). The 8 AM run may have failed — check the Pipeline page.`)
        continue
      }

      // run stats (run whose batch_id = today's website batch)
      let runLine = ''
      if (web) {
        const runs: Array<{ processed_total: number | null; total_imported: number | null; status: string; started_at: string; completed_at: string | null }> =
          await fetchAllRows(`pipeline_runs?batch_id=eq.${web.id}&select=processed_total,total_imported,status,started_at,completed_at&order=started_at`)
        if (runs.length > 0) {
          const scanned = runs.reduce((s, r) => s + (r.processed_total ?? 0), 0)
          const stillRunning = runs.some((r) => r.status === 'running')
          const mins = runs.reduce((s, r) => s + (r.completed_at ? (new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 60000 : 0), 0)
          runLine = `Scanned *${scanned}* places in ${Math.round(mins)} min${stillRunning ? ' — :hourglass: still running' : ''}`
        }
      }

      // leads from both batches
      const ids = [web?.id, nw?.id].filter(Boolean) as string[]
      const leads: LeadRow[] = []
      for (const id of ids) leads.push(...await fetchAllRows<LeadRow>(`leads?batch_id=eq.${id}&select=display_name,data`))

      const webCount = web ? (await fetchAllRows<{ id: string }>(`leads?batch_id=eq.${web.id}&select=id`)).length : 0
      const nwCount = leads.length - webCount
      const adsCount = leads.filter((l) => (l.data?.['Running Google Ads'] ?? '').startsWith('Yes')).length

      const top = [...leads]
        .sort((a, b) => Number(b.data?.['Quality Score'] ?? 0) - Number(a.data?.['Quality Score'] ?? 0))
        .slice(0, 10)
      const topLines = top.map((l, i) => {
        const hook = (l.data?.['Pain Points'] ?? '').split('\n')[0].replace(/^\d+\.\s*/, '').slice(0, 110)
        const ads = (l.data?.['Running Google Ads'] ?? '').startsWith('Yes') ? ' :moneybag:' : ''
        return `${i + 1}. *${l.display_name}*${ads} (q${l.data?.['Quality Score'] ?? '?'}) — ${hook}`
      }).join('\n')

      const text = [
        `:sunrise: *LeadIntel daily digest — ${baseName}*`,
        ``,
        `:white_check_mark: *${leads.length} qualified leads* delivered (target ${cfg.daily_run_target}): ${webCount} website-redesign + ${nwCount} no-website.`,
        runLine,
        adsCount > 0 ? `:moneybag: *${adsCount} are running Google Ads* into weak sites — call these first.` : '',
        ``,
        `*Top leads today:*`,
        topLines || '_none imported yet_',
        ``,
        `Batches: "${baseName} — Website" / "— No Website" in the CRM.`,
      ].filter((l) => l !== '').join('\n')

      await postSlack(text)
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  } catch (e) {
    console.error('[digest] error:', (e as Error).message)
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 })
  }
})
