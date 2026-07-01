/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/pipeline/status?runId=...&orgId=...
// Returns the pipeline_runs row. If completed and xlsx_path is set, attaches a
// 1-hour signed download URL for the XLSX audit log.
import { createSignedUrl, db, readQuery, requireAuth, sendJson } from './_lib.js'

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

    // Auto-fix stuck runs: edge function has 150s timeout. If still 'running' after 5 min, it was killed.
    if (run.status === 'running') {
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
