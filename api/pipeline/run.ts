/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /api/pipeline/run — creates a pipeline_runs row then fires the
// Supabase Edge Function (non-awaited). Returns 202 + run_id immediately.
import { db, fireEdgeFunction, readBody, requireToken, sendJson } from './_lib.js'

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: { code: 'method', message: 'POST only' } })
    if (requireToken(req, res)) return

    const body = await readBody(req)
    const orgId: string = body?.org_id ?? ''
    const dryRun: boolean = body?.dry_run === true

    if (!orgId) return sendJson(res, 400, { error: { code: 'invalid', message: 'org_id is required' } })

    const rows = await db.insert(
      'pipeline_runs',
      { org_id: orgId, dry_run: dryRun, status: 'running' },
      { select: 'id' },
    )
    const runId: string = Array.isArray(rows) ? rows[0]?.id : rows?.id
    if (!runId) return sendJson(res, 500, { error: { code: 'db', message: 'Could not create run record.' } })

    fireEdgeFunction(runId, orgId, dryRun)

    return sendJson(res, 202, { run_id: runId, dry_run: dryRun, status: 'running' })
  } catch (e: any) {
    console.error('[pipeline/run] error:', e?.message, e?.stack)
    return sendJson(res, 500, { error: { code: 'internal', message: e?.message ?? 'Internal error' } })
  }
}
