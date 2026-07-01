/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/pipeline/backlog?orgId=...
// Returns count of google_maps leads that have not yet been marked done (done_at IS NULL).
// Intended to feed a dashboard without a UI for now — just a queryable number.
import { db, readQuery, requireAuth, sendJson } from './_lib.js'

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'GET') return sendJson(res, 405, { error: { code: 'method', message: 'GET only' } })
    if (await requireAuth(req, res)) return

    const orgId = readQuery(req, 'orgId')
    if (!orgId) return sendJson(res, 400, { error: { code: 'invalid', message: 'orgId is required' } })

    // Use PostgREST count via Prefer: count=exact with no body return
    const url = `${process.env.SUPABASE_URL}/rest/v1/leads?org_id=eq.${orgId}&source_type=eq.google_maps&done_at=is.null&select=id`
    const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const res2 = await fetch(url, {
      headers: {
        apikey: svcKey,
        Authorization: `Bearer ${svcKey}`,
        Prefer: 'count=exact',
        'Range-Unit': 'items',
        Range: '0-0',
      },
    })
    const contentRange = res2.headers.get('content-range') ?? ''
    // Content-Range: 0-0/N  →  N is the total count
    const total = parseInt(contentRange.split('/')[1] ?? '0', 10)

    return sendJson(res, 200, { count: isNaN(total) ? 0 : total })
  } catch (e: any) {
    console.error('[pipeline/backlog] error:', e?.message)
    return sendJson(res, 500, { error: { code: 'internal', message: e?.message ?? 'Internal error' } })
  }
}
