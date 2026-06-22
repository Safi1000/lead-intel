import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { Search, Users } from 'lucide-react'
import { manualLeadsApi } from '../../api/endpoints'
import { useAuth, useDebounce } from '../../hooks'
import { Card, Input } from '../../components/ui/primitives'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import { cn } from '../../lib/utils'
import { STATUS_META, STATUS_ORDER, TEMP_META, queueTabsFor } from './workflow'
import type { LeadStatus, ManualLead } from '../../api/types'

export function LeadQueuePage() {
  const { role, user } = useAuth()
  const me = user?.name ?? ''
  const isManagerView = role === 'manager' || role === 'admin' || role === 'superadmin' || role === 'lead_generator'

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['manual-leads'],
    queryFn: () => manualLeadsApi.list(),
  })

  const tabs = useMemo(() => queueTabsFor(role), [role])
  const [tab, setTab] = useState(tabs[0]?.key ?? 'all')
  const [statusFilter, setStatusFilter] = useState<LeadStatus | 'all'>('all')
  const [searchRaw, setSearchRaw] = useState('')
  const search = useDebounce(searchRaw, 200).toLowerCase()

  const activeTab = tabs.find((t) => t.key === tab) ?? tabs[0]
  const leads = data?.data ?? []

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      if (activeTab && !activeTab.filter(l, me)) return false
      if (isManagerView && statusFilter !== 'all' && l.status !== statusFilter) return false
      if (search) {
        const hay = (l.display_name + ' ' + Object.values(l.data).join(' ')).toLowerCase()
        if (!hay.includes(search)) return false
      }
      return true
    })
  }, [leads, activeTab, me, isManagerView, statusFilter, search])

  return (
    <div className="reveal">
      <PageHeader title="Leads" subtitle="The shared pool. Setters pull new leads, closers pick up leads passed on to them." />

      {/* Tabs */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tabs.map((t) => {
          const count = leads.filter((l) => t.filter(l, me)).length
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
                tab === t.key ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:bg-slate-100',
              )}
            >
              {t.label} <span className="tabular-nums opacity-70">{count}</span>
            </button>
          )
        })}
      </div>

      {/* Status chips (manager / generator full view) */}
      {isManagerView && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {(['all', ...STATUS_ORDER] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors',
                statusFilter === s ? 'bg-slate-800 text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:bg-slate-100',
              )}
            >
              {s === 'all' ? 'All statuses' : STATUS_META[s].label}
            </button>
          ))}
        </div>
      )}

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <Input value={searchRaw} onChange={(e) => setSearchRaw(e.target.value)} placeholder="Search leads…" className="pl-9" />
      </div>

      <Card>
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Users} title="No leads here" message={leads.length === 0 ? 'Once leads are uploaded they show up in the pool.' : 'No leads match this view.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th className="px-5 py-2.5 font-medium">Lead</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Temp</th>
                  <th className="px-3 py-2.5 font-medium">Setter</th>
                  <th className="px-3 py-2.5 font-medium">Closer</th>
                  <th className="px-3 py-2.5 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <LeadRow key={l.id} lead={l} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function LeadRow({ lead }: { lead: ManualLead }) {
  const st = STATUS_META[lead.status]
  const temp = lead.temperature ? TEMP_META[lead.temperature] : null
  return (
    <tr className="border-b border-[var(--color-border)] last:border-0 hover:bg-slate-50">
      <td className="px-5 py-3">
        <Link to={`/leads/manual/${lead.id}`} className="font-medium text-[var(--color-text)] hover:text-[var(--color-primary)]">
          {lead.display_name}
        </Link>
        <p className="text-[12px] text-[var(--color-text-muted)]">{lead.template_name}</p>
      </td>
      <td className="px-3 py-3">
        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[12px] font-medium', st.className)}>{st.label}</span>
      </td>
      <td className="px-3 py-3">
        {temp ? (
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium', temp.className)}>
            <temp.icon className="h-3 w-3" /> {temp.label}
          </span>
        ) : (
          <span className="text-[var(--color-text-muted)]">—</span>
        )}
      </td>
      <td className="px-3 py-3 text-[13px] text-[var(--color-text-secondary)]">{lead.setter ?? '—'}</td>
      <td className="px-3 py-3 text-[13px] text-[var(--color-text-secondary)]">{lead.closer ?? '—'}</td>
      <td className="px-3 py-3 text-[13px] text-[var(--color-text-muted)]">{formatDistanceToNow(new Date(lead.updated_at), { addSuffix: true })}</td>
    </tr>
  )
}
