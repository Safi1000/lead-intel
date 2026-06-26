/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /api/bookings/webhook — Cal.com webhook receiver.
//
// Cal.com supports webhooks on every plan (unlike Calendly Free), so we use
// them for INSTANT updates: on any booking create/cancel/reschedule, we push a
// lightweight "changed" ping to the browser via Supabase Realtime, and the AE's
// Meetings page refetches immediately. Polling remains as a fallback.
//
// Auth: configure the webhook URL with ?token=<CAL_WEBHOOK_SECRET>. If the env
// var is set, requests without the matching token are rejected.
import { broadcastBookingsChanged, sendJson } from './_lib'

const RELEVANT = new Set([
  'BOOKING_CREATED',
  'BOOKING_CANCELLED',
  'BOOKING_RESCHEDULED',
  'BOOKING_REQUESTED',
  'BOOKING_REJECTED',
  'BOOKING_PAYMENT_INITIATED',
  'MEETING_ENDED',
])

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: { code: 'method', message: 'POST only' } })

  const secret = process.env.CAL_WEBHOOK_SECRET
  if (secret && req.query?.token !== secret) {
    return sendJson(res, 401, { error: { code: 'unauthorized', message: 'Invalid webhook token' } })
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const trigger = String(body.triggerEvent ?? 'UNKNOWN')

  // Only ping the client for booking-lifecycle events.
  if (RELEVANT.has(trigger) || trigger.startsWith('BOOKING_')) {
    await broadcastBookingsChanged(trigger)
  }

  // Always 200 quickly so Cal.com doesn't retry.
  return sendJson(res, 200, { received: true })
}
