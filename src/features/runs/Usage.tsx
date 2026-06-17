import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { usageApi } from '../../api/endpoints'
import { formatNumber, formatPercent } from '../../lib/utils'
import { shortDate } from '../../lib/time'
import { CardSkeleton, EmptyState, ErrorState } from '../../components/feedback'
import { PageHeader, StatCard, SectionCard } from '../shared/bits'
import type { UsageSummary } from '../../api/types'

export function UsagePage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['usage'],
    queryFn: () => usageApi.get(),
  })

  return (
    <div className="reveal">
      <PageHeader title="Usage" subtitle="Credits, leads delivered, and fill rates over time." />
      {isLoading ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
          <CardSkeleton />
        </div>
      ) : isError || !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : data.series.length === 0 ? (
        <EmptyState
          title="No usage yet"
          message="Launch a run to start delivering leads. Usage trends will show up here."
        />
      ) : (
        <UsageContent data={data} />
      )}
    </div>
  )
}

function UsageContent({ data }: { data: UsageSummary }) {
  const [tradeFilter, setTradeFilter] = useState<string>('all')

  const avgFill = useMemo(() => {
    if (data.series.length === 0) return 0
    return data.series.reduce((s, p) => s + p.fill, 0) / data.series.length
  }, [data.series])

  const creditSeries = data.series.map((p) => ({ name: shortDate(p.date), credits: p.credits }))
  const tradeBars = data.by_trade.map((t) => ({ name: t.trade, leads: t.leads }))

  const filteredTrades =
    tradeFilter === 'all' ? data.by_trade : data.by_trade.filter((t) => t.trade === tradeFilter)

  // Overage when credits delivered exceed total leads' baseline — surface a soft banner.
  const overage = data.total_credits > data.total_leads * 12

  return (
    <div className="space-y-6">
      {overage && (
        <div className="flex items-start gap-3 rounded-[12px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">High credit consumption</p>
            <p>
              You consumed {formatNumber(data.total_credits)} credits for {formatNumber(data.total_leads)} leads
              this period. Review your runs or top up to avoid overage.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total credits" value={formatNumber(data.total_credits)} />
        <StatCard label="Total leads" value={formatNumber(data.total_leads)} />
        <StatCard label="Avg fill rate" value={formatPercent(avgFill)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Credits over time">
          <div className="p-5">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={creditSeries} margin={{ left: -20, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="usage-credits" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563EB" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94A3B8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94A3B8" />
                <RTooltip formatter={(v) => [formatNumber(Number(v)), 'Credits']} />
                <Area type="monotone" dataKey="credits" stroke="#2563EB" strokeWidth={2} fill="url(#usage-credits)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Leads by trade">
          <div className="p-5">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={tradeBars} margin={{ left: -20, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94A3B8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94A3B8" />
                <RTooltip formatter={(v) => [formatNumber(Number(v)), 'Leads']} />
                <Bar dataKey="leads" fill="#2563EB" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="By trade"
        action={
          <select
            value={tradeFilter}
            onChange={(e) => setTradeFilter(e.target.value)}
            className="h-8 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-[13px] text-[var(--color-text)] focus:border-[var(--color-primary)] focus-visible:outline-none"
          >
            <option value="all">All trades</option>
            {data.by_trade.map((t) => (
              <option key={t.trade} value={t.trade}>
                {t.trade}
              </option>
            ))}
          </select>
        }
      >
        {filteredTrades.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-[var(--color-text-muted)]">No data for this trade.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th className="px-5 py-2.5 font-medium">Trade</th>
                  <th className="px-5 py-2.5 font-medium">Leads</th>
                  <th className="px-5 py-2.5 font-medium">Credits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {filteredTrades.map((t) => (
                  <tr key={t.trade}>
                    <td className="px-5 py-3 font-medium capitalize text-[var(--color-text)]">{t.trade}</td>
                    <td className="px-5 py-3 tabular-nums text-[var(--color-text-secondary)]">
                      {formatNumber(t.leads)}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-[var(--color-text-secondary)]">
                      {formatNumber(t.credits)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  )
}
