import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { aiApi } from '../../api/endpoints'
import { Button } from '../../components/ui/primitives'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader, SectionCard, StatCard } from '../shared/bits'
import {
  AIProviderBadge,
  GenerationControls,
  RationaleDisclosure,
  StreamingText,
  useStream,
} from '../../components/ai/streaming'
import { formatPercent } from '../../lib/utils'
import type { MarketSummary } from '../../api/types'

export function MarketSummaryPage() {
  const { runId } = useParams<{ runId: string }>()

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['market-summary', runId],
    queryFn: () => aiApi.marketSummary(runId as string),
    enabled: Boolean(runId),
  })

  return (
    <div className="reveal">
      <PageHeader
        title="Market Summary"
        subtitle="AI-generated opportunity analysis for this run."
        actions={
          <Button variant="outline" size="sm" onClick={() => toast.success('Summary exported')}>
            <Download className="h-3.5 w-3.5" /> Export summary
          </Button>
        }
      />

      {!runId ? (
        <EmptyState title="No run selected" message="Open this page from a run to see its market summary." />
      ) : isLoading ? (
        <LoadingState label="Generating market summary…" />
      ) : isError || !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : data.stats.length === 0 && !data.narrative ? (
        <EmptyState
          title="No summary available"
          message="There isn’t enough signal for this run to generate a market summary yet."
        />
      ) : (
        <MarketSummaryContent data={data} onRegenerate={() => refetch()} regenerating={isFetching} />
      )}
    </div>
  )
}

function MarketSummaryContent({
  data,
  onRegenerate,
  regenerating,
}: {
  data: MarketSummary
  onRegenerate: () => void
  regenerating: boolean
}) {
  const { shown, streaming, stop } = useStream(data.narrative ?? null, [data])

  const chartData = data.stats.map((s) => ({ name: s.label, value: Math.round(s.value * 100) }))

  return (
    <div className="space-y-6">
      <SectionCard
        title={
          <span className="inline-flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--color-primary)]" /> Narrative
          </span>
        }
        action={<AIProviderBadge provider={data.provider} />}
      >
        <div className="p-5">
          <span className="mb-2 inline-flex rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)]">
            AI-generated
          </span>
          <StreamingText text={shown} streaming={streaming} onStop={stop} />
          <GenerationControls onRegenerate={onRegenerate} copyValue={data.narrative} />
          <RationaleDisclosure title="Why these opportunity signals">
            Signals are derived from coverage gaps, fill velocity, and lead density across the run’s
            targeted ZIPs. Higher percentages indicate stronger, less-saturated demand worth
            prioritizing. Review the underlying leads before acting.
          </RationaleDisclosure>
        </div>
      </SectionCard>

      {data.stats.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.stats.map((s) => (
              <StatCard key={s.label} label={s.label} value={formatPercent(s.value)} />
            ))}
          </div>

          <SectionCard title="Opportunity signals">
            <div className="p-5">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData} margin={{ left: -20, right: 8, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94A3B8" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#94A3B8" unit="%" />
                  <RTooltip formatter={(v) => [`${Number(v)}%`, 'Signal']} />
                  <Bar dataKey="value" fill="#2563EB" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        </>
      )}

      <p className="text-[11px] text-[var(--color-text-muted)]">
        AI-generated{regenerating ? ' — regenerating…' : ''}. Verify before making decisions.
      </p>
    </div>
  )
}
