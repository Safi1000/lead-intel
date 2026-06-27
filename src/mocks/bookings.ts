/**
 * MSW handlers + stateful fixtures for the Bookings module.
 *
 * Simulates the Cal.com-backed endpoints our serverless proxy exposes in
 * production. Everything is demoable with `npm run dev` — "upcoming" times are
 * relative to Date.now() so the list always looks live. Per the repo rule there
 * are no Coming-Soon shells: the booking page runs a *simulated* Cal.com flow
 * in demo (POST /api/bookings/simulate) that actually creates a meeting which
 * then appears on the AE side after the next poll.
 */
import { http, HttpResponse, delay } from 'msw'
import type { LeadRemark, ManualLead } from '../api/types'
import type { AeBookingConfig, MatchConfidence, MeetingDTO, MeetingWithLeadDTO } from '../api/bookings'

const ok = (data: unknown) => HttpResponse.json(data as object)
const fail = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status })

let seq = 500
const nid = (p: string) => `${p}_${(seq++).toString(36)}`
const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const AES: AeBookingConfig[] = [
  { aeId: 'hamna', aeName: 'Hamna', schedulingUrl: 'https://cal.com/hamna/30min', demo: true },
  { aeId: 'shayan', aeName: 'Shayan', schedulingUrl: 'https://cal.com/shayan/30min', demo: true },
]

/** Build a CRM lead fixture (reuses the real ManualLead shape — not a new model). */
function mkLead(id: string, data: Record<string, string>, stage: ManualLead['stage'] = 'Booked'): ManualLead {
  return {
    id,
    org_id: 'org_demo',
    batch_id: 'batch_demo',
    setter_id: 'setter_demo',
    closer_id: null,
    template_id: 'tpl_demo',
    template_name: 'Roofing — Q2 import',
    data,
    display_name: data['Company'] || data['Business Name'] || data['Name'] || 'Lead',
    status: 'with_closer',
    stage,
    next_follow_up: null,
    call_at: null,
    done_at: null,
    done_by: null,
    temperature: 'warm',
    setter: 'Priya Nair',
    closer: null,
    remarks: [],
    created_at: iso(-12 * DAY),
    updated_at: iso(-2 * HOUR),
  }
}

function note(author: string, text: string, atMsFromNow: number): LeadRemark {
  return { id: nid('rmk'), author, author_role: 'setter', text, at: iso(atMsFromNow) }
}

const leadCedar = mkLead('lead_cedar', {
  Company: 'Cedar Ridge Roofing',
  'Owner Name': 'Tom Halloran',
  Phone: '(312) 555-0142',
  Email: 'tom@cedarridgeroofing.com',
  Website: 'https://cedarridgeroofing.com',
  Trade: 'Roofing',
  City: 'Chicago, IL',
})
const leadBlue = mkLead('lead_blue', {
  Company: 'Blue Harbor HVAC',
  'Owner Name': 'Maria Esposito',
  Phone: '(617) 555-0199',
  Email: 'maria@blueharborhvac.com',
  Website: 'https://blueharborhvac.com',
  Trade: 'HVAC',
  City: 'Boston, MA',
})
const leadSummit = mkLead('lead_summit', {
  Company: 'Summit Electrical Co.',
  'Owner Name': 'Derek Okafor',
  Phone: '(415) 555-0177',
  Email: 'derek@summitelectric.co',
  Website: 'https://summitelectric.co',
  Trade: 'Electrical',
  City: 'San Francisco, CA',
})
const leadPalm = mkLead('lead_palm', {
  Company: 'Palmetto Plumbing',
  'Owner Name': 'Jen Castellano',
  Phone: '(305) 555-0150',
  Email: 'jen@palmettoplumbing.com',
  Website: 'https://palmettoplumbing.com',
  Trade: 'Plumbing',
  City: 'Miami, FL',
})

const LEADS: Record<string, ManualLead> = {
  lead_cedar: leadCedar,
  lead_blue: leadBlue,
  lead_summit: leadSummit,
  lead_palm: leadPalm,
}

interface Fixture {
  meeting: MeetingDTO
  matchConfidence: MatchConfidence
  setterNotes: LeadRemark[]
}

/** Stateful in-memory store so simulated bookings persist for the session. */
const fixtures: Fixture[] = [
  {
    meeting: {
      id: 'evt_cedar',
      status: 'active',
      startTime: iso(2 * HOUR),
      endTime: iso(2 * HOUR + 30 * MIN),
      eventTypeName: '30 Min Discovery',
      location: { kind: 'zoom', joinUrl: 'https://zoom.us/j/9876543210' },
      aeId: 'hamna',
      invitee: { name: 'Tom Halloran', email: 'tom@cedarridgeroofing.com', timezone: 'America/Chicago' },
      setter: {
        name: 'Priya Nair',
        leadSource: 'Facebook Ad — Storm Damage',
        context: 'Hail damage on a 14-yr-old roof; insurance claim already filed. Wants a same-week inspection. Promised a free drone assessment + claim-support walkthrough.',
      },
      crmLeadId: 'lead_cedar',
      cancelUrl: 'https://calendly.com/cancellations/evt_cedar',
      rescheduleUrl: 'https://calendly.com/reschedulings/evt_cedar',
      syncedAt: iso(0),
    },
    matchConfidence: 'matched_by_id',
    setterNotes: [
      note('Priya Nair', 'Decision-maker confirmed — Tom owns the company outright. Spoke for ~9 min, very warm. Filed an insurance claim last week and is frustrated with his current contractor going dark.', -3 * HOUR),
      note('Priya Nair', 'Heads up: he prefers a call over Zoom but agreed to Zoom. Keep it tight, he has a job site at 2pm.', -2 * HOUR),
    ],
  },
  {
    meeting: {
      id: 'evt_blue',
      status: 'active',
      startTime: iso(5 * HOUR),
      endTime: iso(5 * HOUR + 30 * MIN),
      eventTypeName: '30 Min Discovery',
      location: { kind: 'google_meet', joinUrl: 'https://meet.google.com/abc-defg-hij' },
      aeId: 'hamna',
      invitee: { name: 'Maria Esposito', email: 'maria@blueharborhvac.com', timezone: 'America/New_York' },
      setter: { name: 'Priya Nair', leadSource: 'Cold call list', context: 'Replacing 2 aging rooftop units this season.' },
      // No crmLeadId captured → falls back to email match.
      crmLeadId: undefined,
      cancelUrl: 'https://calendly.com/cancellations/evt_blue',
      rescheduleUrl: 'https://calendly.com/reschedulings/evt_blue',
      syncedAt: iso(0),
    },
    matchConfidence: 'matched_by_email',
    setterNotes: [note('Priya Nair', 'Quick chat — budget approved, just needs timing.', -6 * HOUR)],
  },
  {
    meeting: {
      id: 'evt_summit',
      status: 'active',
      startTime: iso(1 * DAY + 3 * HOUR),
      endTime: iso(1 * DAY + 3 * HOUR + 30 * MIN),
      eventTypeName: '45 Min Strategy',
      location: { kind: 'phone', detail: '+1 (415) 555-0177' },
      aeId: 'hamna',
      invitee: { name: 'Derek Okafor', email: 'derek@summitelectric.co', timezone: 'America/Los_Angeles' },
      setter: {
        name: 'Sam Rivera',
        leadSource: 'Referral',
        context: 'Referred by an existing client; expanding to commercial work and needs lead volume in two new ZIPs.',
      },
      crmLeadId: 'lead_summit',
      cancelUrl: 'https://calendly.com/cancellations/evt_summit',
      rescheduleUrl: 'https://calendly.com/reschedulings/evt_summit',
      syncedAt: iso(0),
    },
    matchConfidence: 'matched_by_id',
    setterNotes: [
      note('Sam Rivera', 'Strong referral. He already knows our results from the referrer. Mostly a pricing + onboarding conversation.', -1 * DAY),
    ],
  },
  {
    meeting: {
      id: 'evt_palm',
      status: 'active',
      startTime: iso(1 * DAY + 7 * HOUR),
      endTime: iso(1 * DAY + 7 * HOUR + 60 * MIN),
      eventTypeName: 'On-site Consultation',
      location: { kind: 'in_person', detail: '1200 Biscayne Blvd, Miami, FL' },
      aeId: 'shayan',
      invitee: { name: 'Jen Castellano', email: 'jen@palmettoplumbing.com', timezone: 'America/New_York' },
      setter: { name: 'Priya Nair', leadSource: 'Google LSA', context: 'High-intent — wants a territory lock for Miami-Dade.' },
      crmLeadId: 'lead_palm',
      cancelUrl: 'https://calendly.com/cancellations/evt_palm',
      rescheduleUrl: 'https://calendly.com/reschedulings/evt_palm',
      syncedAt: iso(0),
    },
    matchConfidence: 'matched_by_id',
    setterNotes: [note('Priya Nair', 'Bring the territory-lock one-pager. She asked about exclusivity twice.', -8 * HOUR)],
  },
  {
    meeting: {
      id: 'evt_unmatched',
      status: 'active',
      startTime: iso(3 * DAY),
      endTime: iso(3 * DAY + 30 * MIN),
      eventTypeName: '30 Min Discovery',
      location: { kind: 'ms_teams', joinUrl: 'https://teams.microsoft.com/l/meetup-join/xyz' },
      aeId: 'shayan',
      invitee: { name: 'Walter Greaves', email: 'walter@greavesroofing.co.uk', timezone: 'Europe/London' },
      setter: { name: 'Sam Rivera', leadSource: 'Webinar', context: 'Attended the spring webinar; curious but early-stage.' },
      // Intentionally no crmLeadId and an email that matches no CRM lead → unmatched.
      crmLeadId: undefined,
      cancelUrl: 'https://calendly.com/cancellations/evt_unmatched',
      rescheduleUrl: 'https://calendly.com/reschedulings/evt_unmatched',
      syncedAt: iso(0),
    },
    matchConfidence: 'unmatched',
    setterNotes: [],
  },
  // Canceled (should never appear in the upcoming list):
  {
    meeting: {
      id: 'evt_canceled',
      status: 'canceled',
      startTime: iso(1 * DAY + 2 * HOUR),
      endTime: iso(1 * DAY + 2 * HOUR + 30 * MIN),
      eventTypeName: '30 Min Discovery',
      location: { kind: 'zoom', joinUrl: 'https://zoom.us/j/0000000000' },
      aeId: 'hamna',
      invitee: { name: 'Cancelled Client', email: 'nope@example.com', timezone: 'America/Chicago' },
      setter: { name: 'Priya Nair' },
      crmLeadId: undefined,
      syncedAt: iso(0),
    },
    matchConfidence: 'unmatched',
    setterNotes: [],
  },
  // Past (active but already started → filtered by min_start_time = now):
  {
    meeting: {
      id: 'evt_past',
      status: 'active',
      startTime: iso(-2 * HOUR),
      endTime: iso(-90 * MIN),
      eventTypeName: '30 Min Discovery',
      location: { kind: 'phone', detail: '+1 (312) 555-0142' },
      aeId: 'hamna',
      invitee: { name: 'Past Client', email: 'past@example.com', timezone: 'America/Chicago' },
      setter: { name: 'Priya Nair' },
      crmLeadId: undefined,
      syncedAt: iso(0),
    },
    matchConfidence: 'unmatched',
    setterNotes: [],
  },
]

function withLead(f: Fixture): MeetingWithLeadDTO {
  const lead = f.meeting.crmLeadId ? LEADS[f.meeting.crmLeadId] : undefined
  return { meeting: { ...f.meeting, syncedAt: iso(0) }, lead, matchConfidence: f.matchConfidence, setterNotes: f.setterNotes }
}

/** Active + future, sorted ascending, scoped to the requested AE. */
function upcomingFor(aeId: string): MeetingWithLeadDTO[] {
  const now = Date.now()
  let rows = fixtures.filter((f) => f.meeting.status === 'active' && new Date(f.meeting.startTime).getTime() >= now)
  let scoped = rows.filter((f) => f.meeting.aeId === aeId)
  // Demo fallback: a real logged-in closer has their own uuid, not 'hamna'.
  // Re-stamp the north AE's meetings to the caller so the demo always looks live.
  if (scoped.length === 0) {
    scoped = rows
      .filter((f) => f.meeting.aeId === 'hamna')
      .map((f) => ({ ...f, meeting: { ...f.meeting, aeId } }))
  }
  return scoped
    .map(withLead)
    .sort((a, b) => new Date(a.meeting.startTime).getTime() - new Date(b.meeting.startTime).getTime())
}

export const bookingsHandlers = [
  http.get('/api/bookings/ae-configs', () => ok(AES)),

  http.get('/api/bookings/upcoming', async ({ request }) => {
    await delay(400)
    const url = new URL(request.url)
    const aeId = url.searchParams.get('aeId') ?? 'hamna'
    return ok(upcomingFor(aeId))
  }),

  // Demo-only: the embedded widget is simulated, so this creates a real meeting
  // that then shows up on the AE side after the next poll.
  http.post('/api/bookings/simulate', async ({ request }) => {
    await delay(500)
    const body = (await request.json()) as {
      aeId: string
      inviteeName: string
      inviteeEmail: string
      setterName?: string
      leadSource?: string
      context?: string
      crmLeadId?: string
    }
    if (!body.inviteeEmail?.trim()) return fail(400, 'invalid', 'Invitee email is required.')
    const id = nid('evt')
    const crmLeadId = body.crmLeadId?.trim() || undefined
    const matched = crmLeadId && LEADS[crmLeadId]
    fixtures.push({
      meeting: {
        id,
        status: 'active',
        startTime: iso(1 * DAY + 4 * HOUR),
        endTime: iso(1 * DAY + 4 * HOUR + 30 * MIN),
        eventTypeName: '30 Min Discovery',
        location: { kind: 'zoom', joinUrl: 'https://zoom.us/j/1122334455' },
        aeId: body.aeId,
        invitee: { name: body.inviteeName || 'New Invitee', email: body.inviteeEmail.trim(), timezone: 'America/New_York' },
        setter: { name: body.setterName, leadSource: body.leadSource, context: body.context },
        crmLeadId,
        cancelUrl: `https://calendly.com/cancellations/${id}`,
        rescheduleUrl: `https://calendly.com/reschedulings/${id}`,
        syncedAt: iso(0),
      },
      matchConfidence: matched ? 'matched_by_id' : 'unmatched',
      setterNotes: body.context ? [note(body.setterName || 'Setter', body.context, 0)] : [],
    })
    return HttpResponse.json({ id }, { status: 201 })
  }),

  http.get('/api/bookings/:id', ({ params }) => {
    const f = fixtures.find((x) => x.meeting.id === params.id)
    return f ? ok(withLead(f)) : fail(404, 'not_found', 'Meeting not found.')
  }),
]
