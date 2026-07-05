/**
 * pipeline-cron — daily auto-run, fired by pg_cron at 03:00 UTC (= 8:00 AM Pakistan time).
 *
 * For every org whose pipeline_config has daily_run_enabled:
 *   1. Skip if today's batch already exists (idempotent — safe against double fires/manual runs).
 *   2. Create the day's batches, named the way the user names them: "6th July - Sunday, 2026"
 *      (— Website / — No Website), dated in Asia/Karachi.
 *   3. Create the pipeline_runs row (qualified_target from config, default 50) and fire chunk 0.
 * The chain then self-drives; pipeline-watchdog (every 2 min) resumes it if a chunk ever dies.
 * Toggled from the Pipeline page (superadmin only).
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PIPELINE_SECRET = Deno.env.get('PIPELINE_SECRET') ?? ''

const TZ = 'Asia/Karachi'

function svcHeaders(extra: Record<string, string> = {}) {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...extra }
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

/** "6th July - Sunday, 2026" in the configured timezone. */
function todayBatchBaseName(): string {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, day: 'numeric', month: 'long', weekday: 'long', year: 'numeric' })
    .formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${ordinal(Number(get('day')))} ${get('month')} - ${get('weekday')}, ${get('year')}`
}

async function createBatch(orgId: string, name: string): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/batches`, {
    method: 'POST', headers: svcHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({
      org_id: orgId, template_id: null, template_name: 'Google Maps Pipeline',
      file_name: name, total_rows: 0, imported_count: 0, rejected_count: 0, created_by: 'pipeline-cron',
    }),
  })
  if (!res.ok) { console.error(`[cron] batch create failed: ${await res.text()}`); return null }
  return (await res.json())[0]?.id ?? null
}

Deno.serve(async (req: Request) => {
  const auth = req.headers.get('Authorization') ?? ''
  if (PIPELINE_SECRET && auth !== `Bearer ${PIPELINE_SECRET}`) {
    return new Response('unauthorized', { status: 401 })
  }

  const started: string[] = []
  const skipped: string[] = []
  try {
    const cfgRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pipeline_config?daily_run_enabled=eq.true&select=org_id,daily_run_target`,
      { headers: svcHeaders() },
    )
    const configs: Array<{ org_id: string; daily_run_target: number }> = cfgRes.ok ? await cfgRes.json() : []
    if (configs.length === 0) return new Response(JSON.stringify({ ok: true, note: 'daily run disabled everywhere' }), { status: 200 })

    const baseName = todayBatchBaseName()

    for (const cfg of configs) {
      // Idempotency: if today's batch already exists for this org, don't run again.
      const dupRes = await fetch(
        `${SUPABASE_URL}/rest/v1/batches?org_id=eq.${cfg.org_id}&file_name=eq.${encodeURIComponent(baseName + ' — Website')}&select=id&limit=1`,
        { headers: svcHeaders() },
      )
      const dup = dupRes.ok ? await dupRes.json() : []
      if (dup.length > 0) { skipped.push(cfg.org_id); continue }

      const target = Math.max(1, Number(cfg.daily_run_target ?? 50))
      const webId = await createBatch(cfg.org_id, `${baseName} — Website`)
      const nwId = await createBatch(cfg.org_id, `${baseName} — No Website`)
      if (!webId || !nwId) continue

      const runRes = await fetch(`${SUPABASE_URL}/rest/v1/pipeline_runs`, {
        method: 'POST', headers: svcHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ org_id: cfg.org_id, status: 'running', qualified_target: target, batch_id: webId, batch_id_no_website: nwId }),
      })
      if (!runRes.ok) { console.error(`[cron] run create failed: ${await runRes.text()}`); continue }
      const runId = (await runRes.json())[0]?.id
      if (!runId) continue

      // Fire chunk 0 (race-then-return; the chain + watchdog take it from here).
      const fire = fetch(`${SUPABASE_URL}/functions/v1/pipeline-run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${PIPELINE_SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_id: runId, org_id: cfg.org_id, qualified_target: target,
          batch_id: webId, batch_id_no_website: nwId, batch_name: baseName, chunk_index: 0,
        }),
      }).catch((e) => console.error('[cron] chunk0 fire failed:', (e as Error).message))
      await Promise.race([fire, new Promise((r) => setTimeout(r, 4000))])

      console.log(`[cron] started daily run for org ${cfg.org_id}: "${baseName}" target ${target}`)
      started.push(runId)
    }
  } catch (e) {
    console.error('[cron] error:', (e as Error).message)
  }

  return new Response(JSON.stringify({ ok: true, started, skipped }), { status: 200 })
})
