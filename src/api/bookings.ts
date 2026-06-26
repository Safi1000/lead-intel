/**
 * Bookings module API (Cal.com-backed).
 *
 * The booking itself happens through the **embedded Cal.com widget** (not an
 * API call). Freshness comes from **Cal.com webhooks** which push an instant
 * "changed" signal to the browser via Supabase Realtime; **polling** remains a
 * fallback (see useBookingsSync). The transport is abstracted so swapping it
 * needs no UI change.
 *
 * The Cal.com API key is a secret and must never reach the browser. The
 * frontend only ever talks to *our* endpoints under `/api/bookings/*`:
 *   - in the demo build, MSW (src/mocks/bookings.ts) answers them with fixtures,
 *   - in production, the Vercel serverless proxy (api/bookings/*) holds each AE's
 *     API key server-side, calls Cal.com, normalizes to these DTOs, and returns them.
 * The frontend is identical across both modes.
 */
import { api } from './client'
import type { LeadRemark, ManualLead } from './types'

/** Normalized meeting location (color is never the only signal — pair with a label). */
export interface MeetingLocation {
  kind: 'zoom' | 'google_meet' | 'ms_teams' | 'phone' | 'in_person' | 'other'
  joinUrl?: string
  detail?: string
}

/** A scheduled Calendly event as surfaced to the AE. Timestamps are ISO 8601 UTC. */
export interface MeetingDTO {
  id: string // calendly event uuid
  status: 'active' | 'canceled'
  startTime: string // ISO 8601 UTC
  endTime: string // ISO 8601 UTC
  eventTypeName: string // e.g. "30 Min Discovery"
  location: MeetingLocation
  aeId: string // which AE this belongs to
  invitee: {
    name: string
    email: string
    timezone?: string
  }
  // Captured via Calendly custom questions at booking time:
  setter: {
    name?: string
    leadSource?: string
    context?: string // short free-text the setter wrote
  }
  crmLeadId?: string // from custom question; used to join to the CRM lead
  cancelUrl?: string
  rescheduleUrl?: string
  syncedAt: string // when our sync last refreshed this
}

export type MatchConfidence = 'matched_by_id' | 'matched_by_email' | 'unmatched'

/**
 * What the Meetings page renders: the meeting joined to the CRM lead + setter notes.
 * Reuses the existing CRM `ManualLead` and `LeadRemark` models — not duplicated.
 */
export interface MeetingWithLeadDTO {
  meeting: MeetingDTO
  lead?: ManualLead // undefined when no CRM lead matched
  matchConfidence: MatchConfidence
  setterNotes: LeadRemark[]
}

/** The embeddable Cal.com scheduling URL for an AE's booking page. */
export interface AeBookingConfig {
  aeId: string
  aeName: string
  schedulingUrl: string // e.g. https://cal.com/hamna/30min
  /** True in the mock/demo build where no real Cal.com account is wired. */
  demo: boolean
}

export const bookingsApi = {
  /** Upcoming (active, future) meetings for one AE, joined to CRM leads + notes, sorted ascending. */
  async getUpcomingMeetings(aeId: string): Promise<MeetingWithLeadDTO[]> {
    const { data } = await api.get<MeetingWithLeadDTO[]>('/bookings/upcoming', { params: { aeId } })
    return data
  },

  /** Single meeting detail. */
  async getMeeting(id: string): Promise<MeetingWithLeadDTO> {
    const { data } = await api.get<MeetingWithLeadDTO>(`/bookings/${id}`)
    return data
  },

  /** AEs a setter can book for, with each AE's embeddable Calendly URL. */
  async listAeConfigs(): Promise<AeBookingConfig[]> {
    const { data } = await api.get<AeBookingConfig[]>('/bookings/ae-configs')
    return data
  },

  /**
   * Demo-only: the embedded Cal.com widget can't actually book in the mock
   * build, so this simulates the `bookingSuccessful` outcome by creating a
   * meeting that then surfaces on the AE side. In production the real widget
   * handles booking and this is never called.
   */
  async simulateBooking(payload: {
    aeId: string
    inviteeName: string
    inviteeEmail: string
    setterName?: string
    leadSource?: string
    context?: string
    crmLeadId?: string
  }): Promise<{ id: string }> {
    const { data } = await api.post<{ id: string }>('/bookings/simulate', payload)
    return data
  },
}
