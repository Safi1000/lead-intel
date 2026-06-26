/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/bookings/:id — single meeting detail (optional ?aeId= hint).
import { getMeetingById, readQuery, sendJson } from './_lib'

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'GET') return sendJson(res, 405, { error: { code: 'method', message: 'GET only' } })
    const id = readQuery(req, 'id')
    const aeId = readQuery(req, 'aeId') || undefined
    if (!id) return sendJson(res, 400, { error: { code: 'invalid', message: 'id is required' } })
    const row = await getMeetingById(id, aeId)
    if (!row) return sendJson(res, 404, { error: { code: 'not_found', message: 'Meeting not found' } })
    return sendJson(res, 200, row)
  } catch (e: any) {
    return sendJson(res, 502, { error: { code: 'cal_error', message: e?.message ?? 'Cal.com request failed' } })
  }
}
