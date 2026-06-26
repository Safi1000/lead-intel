/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/bookings/ae-configs — the AEs a setter can book for, with each AE's
// embeddable Cal.com URL. Driven by the CAL_API_KEY__* / CAL_AE_* env vars.
import { listAes, sendJson } from './_lib.js'

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'GET') return sendJson(res, 405, { error: { code: 'method', message: 'GET only' } })
    const configs = listAes().map((a) => ({
      aeId: a.id,
      aeName: a.name,
      schedulingUrl: a.url,
      demo: false,
    }))
    return sendJson(res, 200, configs)
  } catch (e: any) {
    return sendJson(res, 500, { error: { code: 'error', message: e?.message ?? 'Failed to list AEs' } })
  }
}
