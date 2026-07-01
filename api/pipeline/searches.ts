/* eslint-disable @typescript-eslint/no-explicit-any */
// GET    /api/pipeline/searches?orgId=...          — list all searches for org
// POST   /api/pipeline/searches                    — create { org_id, search_term, location }
// PATCH  /api/pipeline/searches?id=...             — update { enabled }
// DELETE /api/pipeline/searches?id=...             — delete by id
import { db, readBody, readQuery, requireToken, sendJson } from './_lib.js'

export default async function handler(req: any, res: any) {
  try {
    if (requireToken(req, res)) return

    if (req.method === 'GET') {
      const orgId = readQuery(req, 'orgId')
      if (!orgId) return sendJson(res, 400, { error: { code: 'invalid', message: 'orgId is required' } })
      const rows = await db.select('pipeline_searches', {
        filters: `org_id=eq.${orgId}`,
        order: 'created_at.asc',
      })
      return sendJson(res, 200, rows ?? [])
    }

    if (req.method === 'POST') {
      const body = await readBody(req)
      const { org_id, search_term, location } = body ?? {}
      if (!org_id || !search_term || !location)
        return sendJson(res, 400, { error: { code: 'invalid', message: 'org_id, search_term, and location are required' } })
      const rows = await db.insert('pipeline_searches', { org_id, search_term, location }, { select: '*' })
      return sendJson(res, 201, Array.isArray(rows) ? rows[0] : rows)
    }

    if (req.method === 'PATCH') {
      const id = readQuery(req, 'id')
      if (!id) return sendJson(res, 400, { error: { code: 'invalid', message: 'id is required' } })
      const body = await readBody(req)
      const allowed: Record<string, unknown> = {}
      if (body?.enabled !== undefined) allowed.enabled = body.enabled
      if (body?.search_term !== undefined) allowed.search_term = body.search_term
      if (body?.location !== undefined) allowed.location = body.location
      const rows = await db.update('pipeline_searches', allowed, { filters: `id=eq.${id}`, select: '*' })
      return sendJson(res, 200, Array.isArray(rows) ? rows[0] : rows)
    }

    if (req.method === 'DELETE') {
      const id = readQuery(req, 'id')
      if (!id) return sendJson(res, 400, { error: { code: 'invalid', message: 'id is required' } })
      await db.delete('pipeline_searches', { filters: `id=eq.${id}` })
      return sendJson(res, 200, { ok: true })
    }

    return sendJson(res, 405, { error: { code: 'method', message: 'GET, POST, PATCH, or DELETE only' } })
  } catch (e: any) {
    console.error('[pipeline/searches] error:', e?.message)
    return sendJson(res, 500, { error: { code: 'internal', message: e?.message ?? 'Internal error' } })
  }
}
