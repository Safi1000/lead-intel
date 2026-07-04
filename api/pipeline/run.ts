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
    // Qualified-lead job: run until this many WORTHY leads are imported (across many chained chunks).
    const qualifiedTarget: number | undefined = body?.qualified_target != null ? Number(body.qualified_target) : undefined
    // Legacy large-batch job: gather this many PROCESSED leads.
    const targetTotal: number | undefined = body?.target_total != null ? Number(body.target_total) : undefined
    // Name for the batches every lead in this job lands in.
    const batchName: string | undefined = body?.batch_name ? String(body.batch_name).trim().slice(0, 100) : undefined

    if (!orgId) return sendJson(res, 400, { error: { code: 'invalid', message: 'org_id is required' } })
    if (maxPlaces !== undefined && (isNaN(maxPlaces) || maxPlaces < 1))
      return sendJson(res, 400, { error: { code: 'invalid', message: 'max_places must be a positive integer' } })
    if (qualifiedTarget !== undefined && (isNaN(qualifiedTarget) || qualifiedTarget < 1))
      return sendJson(res, 400, { error: { code: 'invalid', message: 'qualified_target must be a positive integer' } })
    if (targetTotal !== undefined && (isNaN(targetTotal) || targetTotal < 1))
      return sendJson(res, 400, { error: { code: 'invalid', message: 'target_total must be a positive integer' } })

    const isJob = qualifiedTarget !== undefined || targetTotal !== undefined
    const baseName = batchName || `Pipeline Run ${new Date().toISOString().slice(0, 10)}`

    async function makeBatch(name: string): Promise<string | null> {
      const bRows = await db.insert(
        'batches',
        { org_id: orgId, template_id: null, template_name: 'Google Maps Pipeline', file_name: name, total_rows: 0, imported_count: 0, rejected_count: 0, created_by: 'pipeline' },
        { select: 'id' },
      )
      return Array.isArray(bRows) ? bRows[0]?.id : bRows?.id
    }

    // Live jobs get TWO batches up front: one for leads with a (weak) website, one for no-website leads.
    let batchId: string | null = null
    let batchIdNoWebsite: string | null = null
    if (!dryRun && isJob) {
      batchId = await makeBatch(`${baseName} — Website`)
      batchIdNoWebsite = await makeBatch(`${baseName} — No Website`)
    }

    const rows = await db.insert(
      'pipeline_runs',
      {
        org_id: orgId,
        dry_run: dryRun,
        status: 'running',
        ...(qualifiedTarget !== undefined ? { qualified_target: qualifiedTarget } : {}),
        ...(targetTotal !== undefined ? { target_total: targetTotal } : {}),
        ...(batchId ? { batch_id: batchId } : {}),
        ...(batchIdNoWebsite ? { batch_id_no_website: batchIdNoWebsite } : {}),
      },
      { select: 'id' },
    )
    const runId: string = Array.isArray(rows) ? rows[0]?.id : rows?.id
    if (!runId) return sendJson(res, 500, { error: { code: 'db', message: 'Could not create run record.' } })

    await fireEdgeFunction(runId, orgId, dryRun, maxPlaces, { qualified_target: qualifiedTarget, target_total: targetTotal, batch_id: batchId, batch_id_no_website: batchIdNoWebsite, batch_name: baseName })

    return sendJson(res, 202, { run_id: runId, batch_id: batchId, batch_id_no_website: batchIdNoWebsite, dry_run: dryRun, status: 'running' })
  } catch (e: any) {
    console.error('[pipeline/run] error:', e?.message, e?.stack)
    return sendJson(res, 500, { error: { code: 'internal', message: e?.message ?? 'Internal error' } })
  }
}
