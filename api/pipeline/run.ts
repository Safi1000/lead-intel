/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /api/pipeline/run — creates a pipeline_runs row then fires the
// Supabase Edge Function (non-awaited). Returns 202 + run_id immediately.
import { db, fireEdgeFunction, readBody, requireAuth, sendJson } from './_lib.js'

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: { code: 'method', message: 'POST only' } })
    if (await requireAuth(req, res)) return

    const body = await readBody(req)
    const orgId: string = body?.org_id ?? ''
    const dryRun: boolean = body?.dry_run === true
    const maxPlaces: number | undefined = body?.max_places != null ? Number(body.max_places) : undefined
    // Large-batch job: target_total = how many leads to gather across many chained chunks.
    const targetTotal: number | undefined = body?.target_total != null ? Number(body.target_total) : undefined
    // Optional name for the CRM batch every lead in this job lands in.
    const batchName: string | undefined = body?.batch_name ? String(body.batch_name).trim().slice(0, 120) : undefined

    if (!orgId) return sendJson(res, 400, { error: { code: 'invalid', message: 'org_id is required' } })
    if (maxPlaces !== undefined && (isNaN(maxPlaces) || maxPlaces < 1))
      return sendJson(res, 400, { error: { code: 'invalid', message: 'max_places must be a positive integer' } })
    if (targetTotal !== undefined && (isNaN(targetTotal) || targetTotal < 1))
      return sendJson(res, 400, { error: { code: 'invalid', message: 'target_total must be a positive integer' } })

    // For a live large-batch job, create the ONE named batch up front so every chunk writes into it.
    let batchId: string | null = null
    if (!dryRun && targetTotal !== undefined) {
      const bRows = await db.insert(
        'batches',
        {
          org_id: orgId,
          template_id: null,
          template_name: 'Google Maps Pipeline',
          file_name: batchName || `Pipeline Run ${new Date().toISOString().slice(0, 10)}`,
          total_rows: targetTotal,
          imported_count: 0,
          rejected_count: 0,
          created_by: 'pipeline',
        },
        { select: 'id' },
      )
      batchId = Array.isArray(bRows) ? bRows[0]?.id : bRows?.id
    }

    const rows = await db.insert(
      'pipeline_runs',
      {
        org_id: orgId,
        dry_run: dryRun,
        status: 'running',
        ...(targetTotal !== undefined ? { target_total: targetTotal } : {}),
        ...(batchId ? { batch_id: batchId } : {}),
      },
      { select: 'id' },
    )
    const runId: string = Array.isArray(rows) ? rows[0]?.id : rows?.id
    if (!runId) return sendJson(res, 500, { error: { code: 'db', message: 'Could not create run record.' } })

    await fireEdgeFunction(runId, orgId, dryRun, maxPlaces, { target_total: targetTotal, batch_id: batchId, batch_name: batchName })

    return sendJson(res, 202, { run_id: runId, batch_id: batchId, dry_run: dryRun, status: 'running' })
  } catch (e: any) {
    console.error('[pipeline/run] error:', e?.message, e?.stack)
    return sendJson(res, 500, { error: { code: 'internal', message: e?.message ?? 'Internal error' } })
  }
}
