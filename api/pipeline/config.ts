/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/pipeline/config?orgId=...       — fetch org's pipeline config (returns defaults if not yet set)
// PUT /api/pipeline/config                 — upsert { org_id, icp_rubric, quality_threshold, max_places_per_run, openai_model,
//                                            daily_run_enabled, daily_run_target } (daily_run_* = superadmin only)
import { db, readBody, readQuery, requireAuth, sendJson } from './_lib.js'

const DEFAULTS = {
  icp_rubric: '',
  quality_threshold: 6,
  max_places_per_run: 100,
  openai_model: 'gpt-4o-mini',
  daily_run_enabled: false,
  daily_run_target: 50,
}

/** Role of the caller's Supabase JWT (null for secret-token/service callers). */
async function callerRole(req: any): Promise<string | null> {
  try {
    const token = (req.headers?.authorization ?? '').replace(/^Bearer\s+/i, '')
    if (!token || token === process.env.PIPELINE_SECRET) return 'superadmin' // secret = trusted automation
    const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
    const authRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
    })
    if (!authRes.ok) return null
    const user = (await authRes.json()) as any
    if (!user?.id) return null
    const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const profRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role`, {
      headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` },
    })
    const rows = profRes.ok ? ((await profRes.json()) as any[]) : []
    return rows[0]?.role ?? null
  } catch {
    return null
  }
}

export default async function handler(req: any, res: any) {
  try {
    if (await requireAuth(req, res)) return

    if (req.method === 'GET') {
      const orgId = readQuery(req, 'orgId')
      if (!orgId) return sendJson(res, 400, { error: { code: 'invalid', message: 'orgId is required' } })
      const rows = await db.select('pipeline_config', { filters: `org_id=eq.${orgId}`, limit: 1 })
      const row = Array.isArray(rows) ? rows[0] : null
      return sendJson(res, 200, row ?? { org_id: orgId, ...DEFAULTS })
    }

    if (req.method === 'PUT') {
      const body = await readBody(req)
      const { org_id, icp_rubric, quality_threshold, max_places_per_run, openai_model, daily_run_enabled, daily_run_target } = body ?? {}
      if (!org_id) return sendJson(res, 400, { error: { code: 'invalid', message: 'org_id is required' } })

      // Existing row — daily_run_* fields are preserved unless the caller is superadmin.
      const existingRows = await db.select('pipeline_config', { filters: `org_id=eq.${org_id}`, limit: 1 })
      const existing = (Array.isArray(existingRows) ? existingRows[0] : null) ?? {}

      let daily = {
        daily_run_enabled: existing.daily_run_enabled ?? DEFAULTS.daily_run_enabled,
        daily_run_target: existing.daily_run_target ?? DEFAULTS.daily_run_target,
      }
      if (daily_run_enabled !== undefined || daily_run_target !== undefined) {
        const role = await callerRole(req)
        if (role !== 'superadmin') {
          return sendJson(res, 403, { error: { code: 'forbidden', message: 'Only the superadmin can change the daily auto-run.' } })
        }
        daily = {
          daily_run_enabled: daily_run_enabled === undefined ? daily.daily_run_enabled : !!daily_run_enabled,
          daily_run_target: daily_run_target === undefined ? daily.daily_run_target : Math.max(1, Math.min(1000, Number(daily_run_target) || DEFAULTS.daily_run_target)),
        }
      }

      const payload = {
        org_id,
        icp_rubric: icp_rubric ?? DEFAULTS.icp_rubric,
        quality_threshold: Number(quality_threshold ?? DEFAULTS.quality_threshold),
        max_places_per_run: Number(max_places_per_run ?? DEFAULTS.max_places_per_run),
        openai_model: openai_model ?? DEFAULTS.openai_model,
        ...daily,
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
