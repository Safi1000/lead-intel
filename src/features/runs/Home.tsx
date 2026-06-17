import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Rocket, Search, FlaskConical } from 'lucide-react'
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { runsApi, batchesApi } from '../../api/endpoints'
import { ACTIVE_RUN_STATUSES } from '../../config/constants'
import { useAuth } from '../../hooks'
import { formatNumber, formatPercent } from '../../lib/utils'
import { relativeTime, shortDate } from '../../lib/time'
import { Button } from '../../components/ui/primitives'
import { CardSkeleton } from '../../components/feedback'
import { EmptyState, ErrorState } from '../../components/feedback'
import { PageHeader, StatCard, StatusBadge, SectionCard, FillChip, ProgressBar } from '../shared/bits'

export function HomePage() {
  const { user } = useAuth()
  const runs = useQuery({ queryKey: ['runs', { page: 1 }], queryFn: () => runsApi.list({ page: 1, page_size: 50 }) })
  const batches = useQuery({ queryKey: ['batches'], queryFn: batchesApi.list })

  const allRuns = runs.data?.data ?? []
  const active = allRuns.filter((r) => ACTIVE_RUN_STATUSES.includes(r.status))
  const completed = allRuns.filter((r) => r.status === 'completed' || r.status === 'partial')
  const leadsDelivered = completed.reduce((s, r) => s + r.leads_found, 0)
  const hotLeads = completed.reduce((s, r) => s + Math.round((r.fill_rate?.owner_phone ?? 0) * r.leads_found * 0.3), 0)
  const recentBatches = (batches.data?.data ?? []).slice(0, 5)

  const trend = [...completed]
    .reverse()
    .map((r, i) => ({ name: `B${i + 1}`, fill: Math.round((r.fill_rate?.overall ?? 0) * 100) }))

  const noRunsEver = !runs.isLoading && allRuns.length === 0

  if (noRunsEver) {
    return (
      <div>
        <PageHeader title={`Welcome, ${user?.name?.split(' ')[0] ?? 'there'}`} />
        <div className="rounded-[16px] border border-[var(--color-border)] bg-[var(--color-surface)] py-6">
          <EmptyState
            icon={Rocket}
            title="Launch your first run"
            message="Pick a trade and market, and LeadIntel will discover and enrich owner-level leads for you."
            action={
              <Link to="/runs/new">
                <Button size="lg"><Plus className="h-4 w-4" /> New Run</Button>
              </Link>
            }
          />
          <div className="mx-auto grid max-w-2xl gap-3 px-6 pb-4 sm:grid-cols-3">
            {[
              ['1. Choose trade & market', 'Roofing in your target city or zips.'],
              ['2. Watch it enrich', 'Live progress with per-field confidence.'],
              ['3. Export & outreach', 'Download CSV or view the fill-rate report.'],
            ].map(([t, d]) => (
              <div key={t} className="rounded-[12px] bg-slate-50 p-4">
                <p className="text-sm font-semibold">{t}</p>
                <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${user?.name?.split(' ')[0] ?? 'there'}`}
        subtitle="Here’s what’s happening across your account."
        actions={
          <Link to="/runs/new">
            <Button><Plus className="h-4 w-4" /> New Run</Button>
          </Link>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {runs.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)
        ) : (
          <>
            <StatCard label="Active Runs" value={active.length} to="/runs?status=running" />
            <StatCard label="Leads Delivered" value={formatNumber(leadsDelivered)} delta={12} hint="This month" />
            <StatCard label="Hot Leads" value={formatNumber(hotLeads)} hint="High-confidence, contactable" />
            <StatCard label="Credits" value="4,200" hint="Plan: Growth" />
          </>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Active runs */}
        <SectionCard
          className="lg:col-span-2"
          title="Active runs"
          action={<Link to="/runs" className="text-[13px] font-medium text-[var(--color-primary)] hover:underline">See all runs</Link>}
        >
          {runs.isError ? (
            <ErrorState onRetry={() => runs.refetch()} />
          ) : active.length === 0 ? (
            <EmptyState icon={FlaskConical} title="No active runs" message="Start a run to see live enrichment progress here." action={<Link to="/runs/new"><Button variant="outline" size="sm">New Run</Button></Link>} />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {active.map((r) => (
                <li key={r.id}>
                  <Link to={`/runs/${r.id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">Roofing · {r.location_label}</span>
                        <StatusBadge status={r.status} />
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <ProgressBar value={r.progress} className="max-w-xs" />
                        <span className="shrink-0 text-[12px] tabular-nums text-[var(--color-text-muted)]">{Math.round(r.progress * 100)}%</span>
                      </div>
                    </div>
                    <div className="hidden shrink-0 text-right sm:block">
                      <p className="text-sm font-semibold tabular-nums">{formatNumber(r.leads_found)}</p>
                      <p className="text-[12px] text-[var(--color-text-muted)]">leads found</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* Fill-rate trend */}
        <SectionCard title="Fill-rate trend">
          <div className="p-5">
            {trend.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">No batches yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={trend} margin={{ left: -20, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563EB" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94A3B8" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#94A3B8" domain={[0, 100]} />
                  <RTooltip formatter={(v) => [`${v}%`, 'Fill rate']} />
                  <Area type="monotone" dataKey="fill" stroke="#2563EB" strokeWidth={2} fill="url(#fill)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </SectionCard>
      </div>

      {/* Recent batches */}
      <div className="mt-6">
        <SectionCard
          title="Recent batches"
          action={<Link to="/batches" className="text-[13px] font-medium text-[var(--color-primary)] hover:underline">See all batches</Link>}
        >
          {batches.isLoading ? (
            <div className="p-5"><CardSkeleton /></div>
          ) : recentBatches.length === 0 ? (
            <EmptyState icon={Search} title="No batches delivered yet" message="Completed runs produce delivery batches with a fill-rate report." />
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {recentBatches.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">Roofing · {b.location_label}</p>
                    <p className="text-[12px] text-[var(--color-text-muted)]" title={shortDate(b.delivered_at)}>
                      {relativeTime(b.delivered_at)} · {formatNumber(b.lead_count)} leads
                    </p>
                  </div>
                  <FillChip value={b.fill_rate} />
                  <div className="flex gap-2">
                    <Link to={`/batches/${b.id}/report`}><Button variant="outline" size="sm">View</Button></Link>
                    <Link to="/exports"><Button variant="ghost" size="sm">Export</Button></Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <p className="mt-4 text-center text-[12px] text-[var(--color-text-muted)]">
        Fill rate shown is across delivered batches · {formatPercent((completed[0]?.fill_rate?.overall) ?? 0)} most recent
      </p>
    </div>
  )
}
