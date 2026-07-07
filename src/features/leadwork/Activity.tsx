import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Activity as ActivityIcon, FileText, Flame, Snowflake } from 'lucide-react'
import { activityFeedApi, usersApi, type ActivityFeedItem } from '../../api/endpoints'
import { Card } from '../../components/ui/primitives'
import { Dialog } from '../../components/ui/Dialog'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'

type Period = '1d' | '1w' | '1m'
const PERIODS: Array<{ key: Period; label: string; days: number }> = [
  { key: '1d', label: 'Today', days: 1 },
  { key: '1w', label: '1 Week', days: 7 },
  { key: '1m', label: '1 Month', days: 30 },
]

const TYPE_STYLES: Record<string, string> = {
  'Stage Change': 'bg-blue-500/10 text-blue-600',
  'Temperature': 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  'Verdict': 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  'Unassigned': 'bg-red-500/10 text-red-600 dark:text-red-400',
  'Remark': 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  'Note': 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  'Booked': 'bg-green-500/10 text-green-600 dark:text-green-400',
}
const typeBadge = (type: string) => TYPE_STYLES[type] ?? 'bg-slate-500/10 text-[var(--color-text-secondary)]'

const NOTE_TYPES = new Set(['Note', 'Remark'])

/** One feed row = one person's work on ONE lead within the selected period. Status change only,
 * note only, or both — always a single row, so 14 leads worked never looks like 28. */
interface FeedGroup {
  key: string
  lead_id: string
  lead_name: string
  author: string | null
  at: string // newest timestamp in the group
  types: string[] // distinct non-note types, display order
  detail: string | null // inline detail (e.g. "Contacted → Booked")
  events: Array<{ label: string; at: string }> // each non-note action with ITS OWN timestamp
  notes: Array<{ type: string; text: string; at: string }>
}

function groupItems(items: ActivityFeedItem[]): FeedGroup[] {
  const groups: FeedGroup[] = []
  const byKey = new Map<string, FeedGroup>()
  for (const i of items) { // items arrive newest-first
    const key = `${i.lead_id}|${i.author ?? ''}`
    let g = byKey.get(key)
    if (!g) {
      g = { key, lead_id: i.lead_id, lead_name: i.lead_name, author: i.author, at: i.at, types: [], detail: null, events: [], notes: [] }
      byKey.set(key, g)
      groups.push(g) // ordered by each lead's most recent action (newest first)
    }
    if (NOTE_TYPES.has(i.type)) {
      if (i.note) g.notes.push({ type: i.type, text: i.note, at: i.at })
    } else {
      if (!g.types.includes(i.type)) g.types.push(i.type)
      if (!g.detail && i.note) g.detail = i.note // most recent, e.g. "New → Contacted"
      g.events.push({ label: i.note ? `${i.type}: ${i.note}` : i.type, at: i.at })
    }
  }
  // Note-only groups still need a label; notes get their own badge alongside other types.
  for (const g of groups) {
    if (g.notes.length > 0 && !g.types.includes('Note')) g.types.push('Note')
    if (g.types.length === 0) g.types.push('—')
  }
  return groups
}

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function ActivityPage() {
  const [period, setPeriod] = useState<Period>('1d')
  const [who, setWho] = useState<string>('all')
  const [noteOpen, setNoteOpen] = useState<FeedGroup | null>(null)

  const since = useMemo(() => {
    const days = PERIODS.find((p) => p.key === period)!.days
    return new Date(Date.now() - days * 86400_000).toISOString()
  }, [period])

  const feedQ = useQuery({ queryKey: ['activity-feed', since], queryFn: () => activityFeedApi.list(since) })
  const usersQ = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list() })
  const verdictQ = useQuery({ queryKey: ['verdict-stats'], queryFn: activityFeedApi.verdictStats })

  const team = useMemo(
    () => (usersQ.data ?? []).filter((u) => u.role === 'setter' || u.role === 'closer'),
    [usersQ.data],
  )
  const groups = useMemo(() => {
    const all = feedQ.data ?? []
    return groupItems(who === 'all' ? all : all.filter((i) => i.author === who))
  }, [feedQ.data, who])

  const rollup = useMemo(() => {
    const by = new Map<string, { leads: Set<string>; calls: number; stages: number; notes: number; booked: number }>()
    for (const i of feedQ.data ?? []) {
      const k = i.author ?? 'Unknown'
      const e = by.get(k) ?? { leads: new Set<string>(), calls: 0, stages: 0, notes: 0, booked: 0 }
      e.leads.add(i.lead_id) // headline = DISTINCT leads worked, not raw action count
      if (i.type.startsWith('Called') || i.type === 'Left Voicemail') e.calls++
      if (i.type === 'Stage Change') e.stages++
      if (NOTE_TYPES.has(i.type)) e.notes++
      if (i.type === 'Booked') e.booked++
      by.set(k, e)
    }
    return [...by.entries()].sort((a, b) => b[1].leads.size - a[1].leads.size)
  }, [feedQ.data])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity"
        subtitle="Everything your setters and closers did — status changes, calls, notes, verdicts."
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-[10px] border border-[var(--color-border)]">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${period === p.key ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <select
          value={who}
          onChange={(e) => setWho(e.target.value)}
          className="h-9 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm focus:border-[var(--color-primary)] focus-visible:outline-none"
        >
          <option value="all">Everyone</option>
          {team.map((u) => (
            <option key={u.id} value={u.name}>{u.name} ({u.role})</option>
          ))}
        </select>
      </div>

      {/* Per-person rollup */}
      {rollup.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {rollup.slice(0, 8).map(([name, s]) => (
            <Card key={name} className="p-4">
              <div className="truncate text-sm font-medium">{name}</div>
              <div className="mt-1 text-2xl font-semibold">{s.leads.size} <span className="text-sm font-normal text-[var(--color-text-muted)]">leads</span></div>
              <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                {s.calls} calls · {s.stages} stage moves · {s.notes} notes{s.booked > 0 ? ` · ${s.booked} booked` : ''}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Setter handoff quality (closer verdicts, all-time) */}
      {(verdictQ.data ?? []).length > 0 && (
        <Card className="p-4">
          <div className="mb-3 text-sm font-medium">Handoff quality — closer verdicts per setter (all-time)</div>
          <div className="flex flex-wrap gap-4">
            {(verdictQ.data ?? []).map((v) => (
              <div key={v.setter} className="flex items-center gap-2 text-sm">
                <span className="font-medium">{v.setter}</span>
                <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400"><Flame className="h-3.5 w-3.5" />{v.warm} warm</span>
                <span className="inline-flex items-center gap-1 text-red-500"><Snowflake className="h-3.5 w-3.5" />{v.not_warm} not warm</span>
                <span className="text-xs text-[var(--color-text-muted)]">({Math.round((v.warm / Math.max(1, v.warm + v.not_warm)) * 100)}% genuine)</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Feed */}
      {feedQ.isLoading ? (
        <LoadingState label="Loading activity…" />
      ) : feedQ.isError ? (
        <ErrorState onRetry={() => feedQ.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState icon={ActivityIcon} title="No activity" message="Nothing recorded in this window for the selected filters." />
      ) : (
        <Card className="divide-y divide-[var(--color-border)]">
          {groups.map((g) => (
            <div key={g.key} className="px-4 py-2.5 text-sm">
              <div className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-xs text-[var(--color-text-muted)]">{timeAgo(g.at)}</span>
                <span className="w-28 shrink-0 truncate font-medium">{g.author ?? '—'}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {g.types.map((t) => (
                    <span key={t} className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeBadge(t)}`}>{t}</span>
                  ))}
                </span>
                <Link to={`/leads/manual/${g.lead_id}`} className="min-w-0 flex-1 truncate text-[var(--color-primary)] hover:underline">
                  {g.lead_name}
                </Link>
                {g.notes.length > 0 && (
                  <button
                    onClick={() => setNoteOpen(g)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs hover:bg-[var(--color-surface-2)]"
                  >
                    <FileText className="h-3.5 w-3.5" /> View note{g.notes.length > 1 ? `s (${g.notes.length})` : ''}
                  </button>
                )}
              </div>
              {(g.events.length > 0 || g.notes.length > 0) && (
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 pl-[8.75rem] text-[11px] text-[var(--color-text-muted)]">
                  {g.events.map((e, idx) => (
                    <span key={idx}>{e.label} · <span className="tabular-nums">{fmtWhen(e.at)}</span></span>
                  ))}
                  {g.notes.map((n, idx) => (
                    <span key={`n${idx}`}>Note added · <span className="tabular-nums">{fmtWhen(n.at)}</span></span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </Card>
      )}

      {/* Note viewer */}
      <Dialog
        open={!!noteOpen}
        onOpenChange={(v) => { if (!v) setNoteOpen(null) }}
        title={noteOpen ? `${noteOpen.author ?? 'Unknown'} on ${noteOpen.lead_name}` : ''}
        description={noteOpen ? (
          <>
            {noteOpen.types.filter((t) => t !== 'Note' && t !== '—').join(' · ')}
            {noteOpen.detail ? ` — ${noteOpen.detail}` : ''}
          </>
        ) : undefined}
      >
        {noteOpen && (
          <div className="space-y-3">
            {noteOpen.notes.map((n, idx) => (
              <div key={idx} className="rounded-[10px] bg-[var(--color-surface-2)] p-3">
                <div className="mb-1 text-xs text-[var(--color-text-muted)]">{n.type} · {new Date(n.at).toLocaleString()}</div>
                <div className="whitespace-pre-wrap text-sm text-[var(--color-text)]">{n.text}</div>
              </div>
            ))}
            <div className="text-right">
              <Link to={`/leads/manual/${noteOpen.lead_id}`} className="text-sm text-[var(--color-primary)] hover:underline">Open lead →</Link>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}
