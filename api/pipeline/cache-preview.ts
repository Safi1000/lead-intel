/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /api/pipeline/cache-preview  { org_id, vertical_key, metros }
//   -> { available: number }
//
// Returns how many already-cached, importable, not-yet-delivered leads exist for this
// org's niche + requested cities. The frontend uses it to price the cached portion of a
// run at 0.9 credits and show "Enjoy 10% off on N leads this run" (never says "cached").
//
// It's an ESTIMATE — the real per-lead discount is applied by the engine at run time.
// Any failure returns { available: 0 } so the discount simply doesn't show (never blocks a run).
import { readBody, requireAuth, sendJson } from './_lib.js'

export default async function handler(req: any, res: any) {
  try {
    if (await requireAuth(req, res)) return
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: { code: 'method', message: 'POST only' } })
    }

    const body = await readBody(req)
    const orgId = body?.org_id
    if (!orgId) return sendJson(res, 400, { error: { code: 'invalid', message: 'org_id is required' } })
    const verticalKey: string | null = body?.vertical_key ?? null
    const metros: string[] = Array.isArray(body?.metros) ? body.metros : []

    const url = `${process.env.SUPABASE_URL}/rest/v1/rpc/cache_preview`
    const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const rpcRes = await fetch(url, {
      method: 'POST',
      headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_org_id: orgId, p_vertical_key: verticalKey, p_metros: metros }),
    })
    if (!rpcRes.ok) throw new Error(await rpcRes.text())
    // A scalar-returning Postgres function comes back as the bare number via PostgREST.
    const available = await rpcRes.json()
    return sendJson(res, 200, { available: Math.max(0, Number(available) || 0) })
  } catch (e: any) {
    console.error('[pipeline/cache-preview] error:', e?.message)
    return sendJson(res, 200, { available: 0 }) // graceful: no discount, never a hard failure
  }
}
