/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/bookings/:id — single meeting detail (optional ?aeId= hint).
import { getMeetingById, sendJson } from './_lib'

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: { code: 'method', message: 'GET only' } })
  const id = (req.query?.id as string) || ''
  const aeId = (req.query?.aeId as string) || undefined
  if (!id) return sendJson(res, 400, { error: { code: 'invalid', message: 'id is required' } })
  try {
    const row = await getMeetingById(id, aeId)
    if (!row) return sendJson(res, 404, { error: { code: 'not_found', message: 'Meeting not found' } })
    return sendJson(res, 200, row)
  } catch (e: any) {
    return sendJson(res, 502, { error: { code: 'calendly_error', message: e?.message ?? 'Calendly request failed' } })
  }
}
