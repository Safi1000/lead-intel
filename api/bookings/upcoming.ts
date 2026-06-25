/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/bookings/upcoming?aeId=... — one AE's upcoming Calendly meetings,
// normalized + joined to CRM leads. The PAT never leaves this server.
import { getUpcomingForAe, sendJson } from './_lib'

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: { code: 'method', message: 'GET only' } })
  const aeId = (req.query?.aeId as string) || ''
  if (!aeId) return sendJson(res, 400, { error: { code: 'invalid', message: 'aeId is required' } })
  try {
    const rows = await getUpcomingForAe(aeId)
    return sendJson(res, 200, rows)
  } catch (e: any) {
    return sendJson(res, 502, { error: { code: 'calendly_error', message: e?.message ?? 'Calendly request failed' } })
  }
}
