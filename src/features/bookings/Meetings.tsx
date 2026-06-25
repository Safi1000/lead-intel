import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, RefreshCw, ExternalLink, StickyNote, Building2, Clock } from 'lucide-react'
import { useAuth, useBookingsSync } from '../../hooks'
import { Button, Card } from '../../components/ui/primitives'
import { EmptyState, ErrorState, CardSkeleton } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import { CopyButton, LocationBadge, MatchBadge } from './components'
import { dayGroupLabel, fmtRange, relativeHint } from './util'
import type { MeetingWithLeadDTO } from '../../api/bookings'
import type { ManualLead } from '../../api/types'

const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone

/** A labeled CRM field with optional copy / link, rendered in the lead block. */
function LeadField({ label, value, kind }: { label: string; value?: string; kind?: 'phone' | 'email' | 'url' }) {
  if (!value) return null
  let display = <span className="font-mono text-[13px] text-[var(--color-text)]">{value}</span>
  if (kind === 'url') {
    const href = value.startsWith('http') ? value : `https://${value}`
    display = (
      <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[13px] text-[var(--color-primary)] hover:underline">
        {value} <ExternalLink className="h-3 w-3" />
      </a>
    )
  } else if (kind === 'email') {
    display = <a href={`mailto:${value}`} className="font-mono text-[13px] text-[var(--color-primary)] hover:underline">{value}</a>
  } else if (kind === 'phone') {
    display = <a href={`tel:${value}`} className="font-mono text-[13px] text-[var(--color-primary)] hover:underline">{value}</a>
  }
  return (
    <div className="group flex items-center justify-between gap-2 py-0.5">
      <dt className="text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
      <dd className="flex items-center gap-1">{display}<CopyButton text={value} className="opacity-0 group-hover:opacity-100" /></dd>
    </div>
  )
}

function LeadBlock({ lead }: { lead: ManualLead }) {
  const d = lead.data
  const get = (...keys: string[]) => keys.map((k) => d[k]).find(Boolean)
  return (
    <div className="rounded-[10px] border border-[var(--color-border)] bg-slate-50/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Building2 className="h-4 w-4 text-[var(--color-text-muted)]" />
        <span className="font-semibold text-[var(--color-text)]">{lead.display_name}</span>
      </div>
      <dl className="space-y-0.5">
        <LeadField label="Owner" value={get('Owner Name', 'Owner', 'Contact')} />
        <LeadField label="Phone" value={get('Phone', 'Owner Phone', 'Business Phone')} kind="phone" />
        <LeadField label="Email" value={get('Email', 'Owner Email')} kind="email" />
        <LeadField label="Website" value={get('Website')} kind="url" />
        <LeadField label="Trade" value={get('Trade')} />
        <LeadField label="Location" value={get('City', 'Location', 'Address')} />
      </dl>
    </div>
  )
}

function SetterNotesBlock({ row }: { row: MeetingWithLeadDTO }) {
  const { setter } = row.meeting
  const hasChips = setter.name || setter.leadSource
  return (
    <div className="rounded-[10px] border border-blue-100 bg-blue-50/50 p-3">
      <div className="mb-2 flex items-center gap-2 text-[var(--color-text)]">
        <StickyNote className="h-4 w-4 text-[var(--color-primary)]" />
        <span className="text-sm font-semibold">Setter prep</span>
      </div>
      {hasChips && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {setter.name && <Chip label="Set by" value={setter.name} />}
          {setter.leadSource && <Chip label="Source" value={setter.leadSource} />}
        </div>
      )}
      {setter.context ? (
        <p className="text-sm leading-relaxed text-[var(--color-text)]">{setter.context}</p>
      ) : (
        <p className="text-sm italic text-[var(--color-text-muted)]">No context note left by the setter.</p>
      )}
      {row.setterNotes.length > 0 && (
        <ul className="mt-2 space-y-1.5 border-t border-blue-100 pt-2">
          {row.setterNotes.map((n) => (
            <li key={n.id} className="text-[13px] text-[var(--color-text-secondary)]">
              <span className="font-medium text-[var(--color-text)]">{n.author}: </span>{n.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[12px] ring-1 ring-blue-100">
      <span className="text-[var(--color-text-muted)]">{label}</span>
      <span className="font-medium text-[var(--color-text)]">{value}</span>
    </span>
  )
}

function MeetingCard({ row, tz }: { row: MeetingWithLeadDTO; tz: string }) {
  const { meeting } = row
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-col gap-1 border-b border-[var(--color-border)] pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[15px] font-semibold text-[var(--color-text)]">{fmtRange(meeting.startTime, meeting.endTime, tz)}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[12px] font-medium text-slate-600">
            <Clock className="h-3 w-3" /> {relativeHint(meeting.startTime)}
          </span>
        </div>
        <span className="text-sm font-medium text-[var(--color-text-secondary)]">{meeting.eventTypeName}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 py-3">
        <LocationBadge location={meeting.location} />
        <MatchBadge confidence={row.matchConfidence} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {row.lead ? (
          <LeadBlock lead={row.lead} />
        ) : (
          <div className="rounded-[10px] border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-800">
            <p className="font-medium">No CRM lead matched.</p>
            <p className="mt-1">Invitee: <span className="font-mono">{meeting.invitee.name}</span> · <span className="font-mono">{meeting.invitee.email}</span></p>
            <p className="mt-1 text-[12px] text-amber-700">Ask the setter to include the CRM Lead ID when booking.</p>
          </div>
        )}
        <SetterNotesBlock row={row} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-3">
        <span className="text-[13px] text-[var(--color-text-muted)]">
          Invitee: <span className="font-medium text-[var(--color-text-secondary)]">{meeting.invitee.name}</span>
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {row.lead && (
            <Link to={`/leads/manual/${row.lead.id}`}>
              <Button size="sm" variant="outline"><ExternalLink className="h-3.5 w-3.5" /> Open lead</Button>
            </Link>
          )}
          {meeting.rescheduleUrl && (
            <a href={meeting.rescheduleUrl} target="_blank" rel="noreferrer">
              <Button size="sm" variant="ghost">Reschedule</Button>
            </a>
          )}
          {meeting.cancelUrl && (
            <a href={meeting.cancelUrl} target="_blank" rel="noreferrer">
              <Button size="sm" variant="ghost">Cancel</Button>
            </a>
          )}
        </span>
      </div>
    </Card>
  )
}

export function MeetingsPage() {
  const { user } = useAuth()
  const tz = user?.timezone || browserTz
  // The proxy matches a closer to their Calendly account by login email (falls
  // back to the short AE id). In the demo the value is ignored — the mock always
  // returns live-looking meetings.
  const aeId = user?.email || user?.id
  const { meetings, lastSyncedAt, isLoading, isError, isFetching, refetch } = useBookingsSync(aeId)

  // Group meetings by day label, preserving ascending order.
  const groups = useMemo(() => {
    const map = new Map<string, MeetingWithLeadDTO[]>()
    for (const row of meetings) {
      const key = dayGroupLabel(row.meeting.startTime, tz)
      const arr = map.get(key) ?? []
      arr.push(row)
      map.set(key, arr)
    }
    return Array.from(map.entries())
  }, [meetings, tz])

  const syncedLabel = lastSyncedAt
    ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(lastSyncedAt)
    : '—'

  return (
    <div className="reveal">
      <PageHeader
        title="My upcoming meetings"
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>{user?.name ? `${user.name} · ` : ''}{tz}</span>
            <span className="text-[var(--color-text-muted)]">·</span>
            <span className="inline-flex items-center gap-1 text-[var(--color-text-muted)]">
              <CalendarClock className="h-3.5 w-3.5" /> Last synced {syncedLabel} · auto-refreshes every 2 min
            </span>
          </span>
        }
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} loading={isFetching}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-4"><CardSkeleton /><CardSkeleton /><CardSkeleton /></div>
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} message="Couldn’t load your meetings. Check the connection and retry." />
      ) : meetings.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No upcoming meetings"
          message="When a setter books a call for you it appears here within ~2 minutes. Setters book from the “Book a meeting” page."
        />
      ) : (
        <div className="space-y-8">
          {groups.map(([day, rows]) => (
            <section key={day}>
              <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{day}</h2>
              <div className="space-y-4">
                {rows.map((row) => (
                  <MeetingCard key={row.meeting.id} row={row} tz={tz} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
