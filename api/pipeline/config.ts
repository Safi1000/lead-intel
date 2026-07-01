/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/pipeline/config?orgId=...       — fetch org's pipeline config (returns defaults if not yet set)
// PUT /api/pipeline/config                 — upsert { org_id, icp_rubric, quality_threshold, max_places_per_run, openai_model }
import { db, readBody, readQuery, requireToken, sendJson } from './_lib.js'

const DEFAULTS = {
  icp_rubric: '',
  quality_threshold: 6,
  max_places_per_run: 100,
  openai_model: 'gpt-4o-mini',
}

export default async function handler(req: any, res: any) {
  try {
    if (requireToken(req, res)) return

    if (req.method === 'GET') {
      const orgId = readQuery(req, 'orgId')
      if (!orgId) return sendJson(res, 400, { error: { code: 'invalid', message: 'orgId is required' } })
      const rows = await db.select('pipeline_config', { filters: `org_id=eq.${orgId}`, limit: 1 })
      const row = Array.isArray(rows) ? rows[0] : null
      return sendJson(res, 200, row ?? { org_id: orgId, ...DEFAULTS })
    }

    if (req.method === 'PUT') {
      const body = await readBody(req)
      const { org_id, icp_rubric, quality_threshold, max_places_per_run, openai_model } = body ?? {}
      if (!org_id) return sendJson(res, 400, { error: { code: 'invalid', message: 'org_id is required' } })

      const payload = {
        org_id,
        icp_rubric: icp_rubric ?? DEFAULTS.icp_rubric,
        quality_threshold: Number(quality_threshold ?? DEFAULTS.quality_threshold),
        max_places_per_run: Number(max_places_per_run ?? DEFAULTS.max_places_per_run),
        openai_model: openai_model ?? DEFAULTS.openai_model,
        updated_at: new Date().toISOString(),
      }

      // PostgREST upsert via Prefer: resolution=merge-duplicates
      const upsertUrl = `${process.env.SUPABASE_URL}/rest/v1/pipeline_config`
      const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
      const upsertRes = await fetch(upsertUrl + '?on_conflict=org_id', {
        method: 'POST',
        headers: {
          apikey: svcKey,
          Authorization: `Bearer ${svcKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify(payload),
      })
      if (!upsertRes.ok) throw new Error(await upsertRes.text())
      const rows = await upsertRes.json()
      return sendJson(res, 200, Array.isArray(rows) ? rows[0] : rows)
    }

    return sendJson(res, 405, { error: { code: 'method', message: 'GET or PUT only' } })
  } catch (e: any) {
    console.error('[pipeline/config] error:', e?.message)
    return sendJson(res, 500, { error: { code: 'internal', message: e?.message ?? 'Internal error' } })
  }
}
