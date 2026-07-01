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
