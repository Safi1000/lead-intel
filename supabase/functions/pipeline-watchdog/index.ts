/**
 * pipeline-watchdog — scheduled janitor (pg_cron fires it every 2 minutes).
 *
 * Replaces the browser-dependent watchdog in /api/pipeline/status.ts: chains now self-heal even
 * when nobody has the Pipeline page open (unattended/cron runs).
 *
 *   1. RESUME stalled chaining runs — healthy chains heartbeat last_progress_at every chunk
 *      (≤2 min); >4 min silent means a chunk died mid-handoff → re-fire the next chunk.
 *   2. FAIL zombie legacy (non-chaining) runs still 'running' after 5 min (150s edge limit).
 *   3. FAIL chains running >12h (safety net against infinite loops).
 *   4. REGENERATE the XLSX of runs completed 45+ min ago (once) — by then review enrichment and
 *      ads verdicts have landed, so the export matches the CRM instead of finalize-time data.
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PIPELINE_SECRET = Deno.env.get('PIPELINE_SECRET') ?? ''

const STALL_MS = 4 * 60 * 1000
const LEGACY_ZOMBIE_MS = 5 * 60 * 1000
const MAX_CHAIN_MS = 12 * 60 * 60 * 1000
const XLSX_SETTLE_MS = 45 * 60 * 1000
const XLSX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function svcHeaders(extra: Record<string, string> = {}) {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...extra }
}

interface Run {
  id: string; org_id: string; status: string; dry_run: boolean | null
  target_total: number | null; qualified_target: number | null
  batch_id: string | null; batch_id_no_website: string | null
  chunk_index: number | null; started_at: string; completed_at: string | null
  last_progress_at: string | null; stop_requested: boolean | null
  xlsx_path: string | null; xlsx_regenerated_at: string | null
}

async function patchRun(id: string, body: unknown) {
  await fetch(`${SUPABASE_URL}/rest/v1/pipeline_runs?id=eq.${id}`, {
    method: 'PATCH', headers: svcHeaders({ Prefer: 'return=minimal' }), body: JSON.stringify(body),
  })
}

async function firePipeline(body: unknown): Promise<number> {
  // race-then-return: get the invocation in flight without waiting for the chunk to finish
  const p = fetch(`${SUPABASE_URL}/functions/v1/pipeline-run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PIPELINE_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.status).catch(() => 0)
  return await Promise.race([p, new Promise<number>((res) => setTimeout(() => res(202), 4000))])
}

Deno.serve(async (req: Request) => {
  const auth = req.headers.get('Authorization') ?? ''
  if (PIPELINE_SECRET && auth !== `Bearer ${PIPELINE_SECRET}`) {
    return new Response('unauthorized', { status: 401 })
  }
  const now = Date.now()
  const report = { resumed: 0, failed_legacy: 0, failed_overrun: 0, xlsx_regenerated: 0 }

  try {
    // --- running runs ---
    const runningRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pipeline_runs?status=eq.running&select=id,org_id,status,dry_run,target_total,qualified_target,batch_id,batch_id_no_website,chunk_index,started_at,completed_at,last_progress_at,stop_requested,xlsx_path,xlsx_regenerated_at&limit=20`,
      { headers: svcHeaders() },
    )
    const running: Run[] = runningRes.ok ? await runningRes.json() : []

    let resumes = 0
    for (const run of running) {
      if (run.stop_requested) continue
      const isChaining = run.target_total != null || run.qualified_target != null
      const age = now - new Date(run.started_at).getTime()
      if (!isChaining) {
        if (age > LEGACY_ZOMBIE_MS) {
          await patchRun(run.id, { status: 'failed', completed_at: new Date().toISOString(), error: 'Edge function timed out (150s limit).' })
          report.failed_legacy++
        }
        continue
      }
      if (age > MAX_CHAIN_MS) {
        await patchRun(run.id, { status: 'failed', completed_at: new Date().toISOString(), error: 'Watchdog: run exceeded 12h — stopped as a safety measure.' })
        report.failed_overrun++
        continue
      }
      const lastBeat = new Date(run.last_progress_at ?? run.started_at).getTime()
      if (now - lastBeat > STALL_MS && resumes < 3) {
        resumes++
        // bump heartbeat FIRST so overlapping ticks don't double-fire the same run
        await patchRun(run.id, { last_progress_at: new Date().toISOString() })
        await firePipeline({
          run_id: run.id, org_id: run.org_id, dry_run: run.dry_run === true,
          target_total: run.target_total ?? undefined, qualified_target: run.qualified_target ?? undefined,
          batch_id: run.batch_id, batch_id_no_website: run.batch_id_no_website,
          chunk_index: Number(run.chunk_index ?? 0),
        })
        console.log(`[watchdog] resumed stalled run ${run.id} at chunk ${run.chunk_index}`)
        report.resumed++
      }
    }

    // --- post-completion XLSX regeneration (one run per tick to stay light) ---
    const doneRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pipeline_runs?status=eq.completed&xlsx_regenerated_at=is.null&xlsx_path=not.is.null&completed_at=not.is.null&order=completed_at.desc&select=id,org_id,completed_at&limit=10`,
      { headers: svcHeaders() },
    )
    const done: Array<{ id: string; org_id: string; completed_at: string }> = doneRes.ok ? await doneRes.json() : []
    for (const run of done) {
      const settled = now - new Date(run.completed_at).getTime()
      if (settled > XLSX_MAX_AGE_MS) { await patchRun(run.id, { xlsx_regenerated_at: new Date().toISOString() }); continue } // too old — retire from the queue
      if (settled < XLSX_SETTLE_MS) continue
      const status = await firePipeline({ action: 'regenerate_xlsx', run_id: run.id, org_id: run.org_id })
      console.log(`[watchdog] xlsx regeneration for ${run.id} -> ${status}`)
      report.xlsx_regenerated++
      break // one per tick
    }
  } catch (e) {
    console.error('[watchdog] error:', (e as Error).message)
  }

  return new Response(JSON.stringify({ ok: true, ...report }), { status: 200 })
})
