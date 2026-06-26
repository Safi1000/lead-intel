/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/bookings/upcoming?aeId=... — one AE's upcoming Cal.com meetings,
// normalized + joined to CRM leads. The API key never leaves this server.
import { getUpcomingForAe, readQuery, sendJson } from './_lib'

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'GET') return sendJson(res, 405, { error: { code: 'method', message: 'GET only' } })
    const aeId = readQuery(req, 'aeId')
    if (!aeId) return sendJson(res, 400, { error: { code: 'invalid', message: 'aeId is required' } })
    const rows = await getUpcomingForAe(aeId)
    return sendJson(res, 200, rows)
  } catch (e: any) {
    console.error('[bookings/upcoming] error:', e?.message, e?.stack)
    return sendJson(res, 502, { error: { code: 'cal_error', message: e?.message ?? 'Cal.com request failed' } })
  }
}
