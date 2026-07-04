import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Activity as ActivityIcon, FileText, Flame, Snowflake, X } from 'lucide-react'
import { activityFeedApi, usersApi, type ActivityFeedItem } from '../../api/endpoints'
import { Card } from '../../components/ui/primitives'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'

type Period = '1d' | '1w' | '1m'
const PERIODS: Array<{ key: Period; label: string; days: number }> = [
  { key: '1d', label: 'Today', days: 1 },
  { key: '1w', label: '1 Week', days: 7 },
  { key: '1m', label: '1 Month', days: 30 },
]

const TYPE_STYLES: Record<string, string> = {
  'Stage Change': 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  'Temperature': 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  'Verdict': 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  'Unassigned': 'bg-red-500/10 text-red-600 dark:text-red-400',
  'Remark': 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  'Note': 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  'Booked': 'bg-green-500/10 text-green-600 dark:text-green-400',
}

function typeBadge(type: string) {
  return TYPE_STYLES[type] ?? 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400'
}

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function ActivityPage() {
  const [period, setPeriod] = useState<Period>('1d')
  const [who, setWho] = useState<string>('all') // author name ('all' = everyone)
  const [noteOpen, setNoteOpen] = useState<ActivityFeedItem | null>(null)

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
  const items = useMemo(() => {
    const all = feedQ.data ?? []
    return who === 'all' ? all : all.filter((i) => i.author === who)
  }, [feedQ.data, who])

  // Per-person rollup over the filtered window
  const rollup = useMemo(() => {
    const by = new Map<string, { total: number; calls: number; stages: number; notes: number; booked: number }>()
    for (const i of feedQ.data ?? []) {
      const k = i.author ?? 'Unknown'
      const e = by.get(k) ?? { total: 0, calls: 0, stages: 0, notes: 0, booked: 0 }
      e.total++
      if (i.type.startsWith('Called') || i.type === 'Left Voicemail') e.calls++
      if (i.type === 'Stage Change') e.stages++
      if (i.type === 'Note' || i.type === 'Remark') e.notes++
      if (i.type === 'Booked') e.booked++
      by.set(k, e)
    }
    return [...by.entries()].sort((a, b) => b[1].total - a[1].total)
  }, [feedQ.data])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity"
        subtitle="Everything your setters and closers did — status changes, calls, notes, verdicts."
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-border overflow-hidden">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${period === p.key ? 'bg-primary text-primary-foreground' : 'bg-transparent hover:bg-muted'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <select
          value={who}
          onChange={(e) => setWho(e.target.value)}
          className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
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
              <div className="font-medium text-sm truncate">{name}</div>
              <div className="mt-1 text-2xl font-semibold">{s.total}</div>
              <div className="mt-1 text-xs text-muted-foreground">
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
                <span className="text-muted-foreground text-xs">({Math.round((v.warm / Math.max(1, v.warm + v.not_warm)) * 100)}% genuine)</span>
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
      ) : items.length === 0 ? (
        <EmptyState icon={ActivityIcon} title="No activity" message="Nothing recorded in this window for the selected filters." />
      ) : (
        <Card className="divide-y divide-border">
          {items.map((i) => (
            <div key={`${i.kind}-${i.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="w-32 shrink-0 text-xs text-muted-foreground">{timeAgo(i.at)}</span>
              <span className="w-28 shrink-0 truncate font-medium">{i.author ?? '—'}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${typeBadge(i.type)}`}>{i.type}</span>
              <Link to={`/leads/manual/${i.lead_id}`} className="min-w-0 flex-1 truncate text-primary hover:underline">
                {i.lead_name}
              </Link>
              {i.note ? (
                (i.type === 'Note' || i.type === 'Remark') ? (
                  <button
                    onClick={() => setNoteOpen(i)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                  >
                    <FileText className="h-3.5 w-3.5" /> View note
                  </button>
                ) : (
                  <span className="hidden max-w-[16rem] truncate text-xs text-muted-foreground md:block">{i.note}</span>
                )
              ) : null}
            </div>
          ))}
        </Card>
      )}

      {/* Note viewer */}
      {noteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setNoteOpen(null)}>
          <div className="w-full max-w-lg rounded-xl border border-border bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-sm font-semibold">{noteOpen.type} — {noteOpen.author ?? 'Unknown'}</div>
              <button onClick={() => setNoteOpen(null)} className="rounded-md p-1 hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="mb-3 text-xs text-muted-foreground">
              on <Link to={`/leads/manual/${noteOpen.lead_id}`} className="text-primary hover:underline">{noteOpen.lead_name}</Link> · {new Date(noteOpen.at).toLocaleString()}
            </div>
            <div className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm">{noteOpen.note}</div>
          </div>
        </div>
      )}
    </div>
  )
}
