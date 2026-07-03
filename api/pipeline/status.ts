/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/pipeline/status?runId=...&orgId=...
// Returns the pipeline_runs row. If completed and xlsx_path is set, attaches a
// 1-hour signed download URL for the XLSX audit log.
import { createSignedUrl, db, fireEdgeFunction, readQuery, requireAuth, sendJson } from './_lib.js'

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'GET') return sendJson(res, 405, { error: { code: 'method', message: 'GET only' } })
    if (await requireAuth(req, res)) return

    const runId = readQuery(req, 'runId')
    const orgId = readQuery(req, 'orgId')
    if (!runId || !orgId) return sendJson(res, 400, { error: { code: 'invalid', message: 'runId and orgId are required' } })

    const rows = await db.select('pipeline_runs', { filters: `id=eq.${runId}&org_id=eq.${orgId}`, limit: 1 })
    const run = Array.isArray(rows) ? rows[0] : null
    if (!run) return sendJson(res, 404, { error: { code: 'not_found', message: 'Run not found.' } })

    // Watchdog for stuck 'running' runs.
    if (run.status === 'running') {
      const isChaining = run.target_total != null
      if (isChaining) {
        // A chaining job legitimately runs for many minutes. Instead of age, watch PROGRESS: a healthy
        // chain heartbeats last_progress_at each chunk (~every ≤2 min). If it hasn't advanced in >4 min,
        // a chunk was dropped — RESUME by re-firing the next chunk rather than failing the whole job.
        const lastBeat = run.last_progress_at ? new Date(run.last_progress_at).getTime() : new Date(run.started_at).getTime()
        const stalledMs = Date.now() - lastBeat
        if (stalledMs > 4 * 60 * 1000) {
          try {
            await fireEdgeFunction(runId, orgId, run.dry_run === true, undefined, {
              target_total: Number(run.target_total),
              batch_id: run.batch_id ?? null,
              chunk_index: Number(run.chunk_index ?? 0),
            })
            // bump the heartbeat so a rapid re-poll doesn't double-fire
            const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
            await fetch(`${process.env.SUPABASE_URL}/rest/v1/pipeline_runs?id=eq.${runId}`, {
              method: 'PATCH',
              headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
              body: JSON.stringify({ last_progress_at: new Date().toISOString() }),
            })
            run.last_progress_at = new Date().toISOString()
          } catch (e: any) {
            console.error('[pipeline/status] resume failed:', e?.message)
          }
        }
      } else {
        // Legacy single-invocation run: 150s edge limit, so still 'running' after 5 min = killed.
        const ageMs = Date.now() - new Date(run.started_at).getTime()
        if (ageMs > 5 * 60 * 1000) {
          const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
          await fetch(`${process.env.SUPABASE_URL}/rest/v1/pipeline_runs?id=eq.${runId}`, {
            method: 'PATCH',
            headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ status: 'failed', completed_at: new Date().toISOString(), error: 'Edge function timed out (150s limit). Try a smaller max leads value.' }),
          })
          run.status = 'failed'
          run.error = 'Edge function timed out (150s limit). Try a smaller max leads value.'
        }
      }
    }

    let xlsx_url: string | null = null
    if (run.xlsx_path) {
      xlsx_url = await createSignedUrl('pipeline-exports', run.xlsx_path)
    }

    return sendJson(res, 200, { ...run, xlsx_url })
  } catch (e: any) {
    console.error('[pipeline/status] error:', e?.message)
    return sendJson(res, 500, { error: { code: 'internal', message: e?.message ?? 'Internal error' } })
  }
}
