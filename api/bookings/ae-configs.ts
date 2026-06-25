/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/bookings/ae-configs — the AEs a setter can book for, with each AE's
// embeddable Calendly URL. Driven by the CALENDLY_PAT__* / CALENDLY_AE_* env vars.
import { listAes, sendJson } from './_lib'

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: { code: 'method', message: 'GET only' } })
  const configs = listAes().map((a) => ({
    aeId: a.id,
    aeName: a.name,
    calendlyEventUrl: a.url,
    demo: false,
  }))
  return sendJson(res, 200, configs)
}
