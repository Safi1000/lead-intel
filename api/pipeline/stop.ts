/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /api/pipeline/stop
// Sets stop_requested = true on a running pipeline_runs row.
// The edge function checks this flag every 5 leads and exits cleanly when set.
import { db, readBody, requireAuth, sendJson } from './_lib.js'

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: { code: 'method', message: 'POST only' } })
    if (await requireAuth(req, res)) return

    const body = await readBody(req)
    const { run_id, org_id } = body ?? {}
    if (!run_id || !org_id) return sendJson(res, 400, { error: { code: 'invalid', message: 'run_id and org_id are required' } })

    const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const url = `${process.env.SUPABASE_URL}/rest/v1/pipeline_runs?id=eq.${run_id}&org_id=eq.${org_id}&status=eq.running`

    const patchRes = await fetch(url, {
      method: 'PATCH',
      headers: {
        apikey: svcKey,
        Authorization: `Bearer ${svcKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ stop_requested: true }),
    })

    if (!patchRes.ok) {
      const text = await patchRes.text()
      return sendJson(res, 500, { error: { code: 'db', message: text } })
    }

    const rows = await patchRes.json()
    if (!rows.length) return sendJson(res, 404, { error: { code: 'not_found', message: 'No running run found with that id + org' } })

    return sendJson(res, 200, { ok: true })
  } catch (e: any) {
    console.error('[pipeline/stop] error:', e?.message)
    return sendJson(res, 500, { error: { code: 'internal', message: e?.message ?? 'Internal error' } })
  }
}
