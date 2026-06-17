import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Map as MapIcon } from 'lucide-react'
import { toast } from 'sonner'
import { marketMapApi, tradesApi } from '../../api/endpoints'
import { Input } from '../../components/ui/primitives'
import { Tooltip } from '../../components/ui/controls'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader, SectionCard, StatCard } from '../shared/bits'
import { cn, formatNumber, formatPercent } from '../../lib/utils'

type Zip = { zip: string; covered: boolean; leads: number; fill: number; locked?: boolean }

export function MarketMapPage() {
  const [trade, setTrade] = useState('')
  const [city, setCity] = useState('')

  const tradesQuery = useQuery({
    queryKey: ['trades', 'US'],
    queryFn: () => tradesApi.list('US'),
  })

  const params = useMemo(
    () => ({ trade: trade || undefined, city: city.trim() || undefined }),
    [trade, city],
  )

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['market-map', params],
    queryFn: () => marketMapApi.get(params),
  })

  const stats = useMemo(() => {
    const zips = data?.zips ?? []
    const covered = zips.filter((z) => z.covered)
    const totalLeads = zips.reduce((s, z) => s + z.leads, 0)
    const avgFill = zips.length ? zips.reduce((s, z) => s + z.fill, 0) / zips.length : 0
    return { coveredCount: covered.length, totalLeads, avgFill }
  }, [data])

  return (
    <div className="reveal">
      <PageHeader
        title="Market Coverage"
        subtitle="Choropleth view of ZIP coverage, fill, and locked territories."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-surface-2)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-text-secondary)]">
            <MapIcon className="h-3.5 w-3.5" /> Choropleth view
          </span>
        }
      />

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-56">
          <label className="mb-1.5 block text-sm font-medium text-[var(--color-text)]">Trade</label>
          <select
            value={trade}
            onChange={(e) => setTrade(e.target.value)}
            className="h-9 w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus-visible:outline-none"
          >
            <option value="">All trades</option>
            {(tradesQuery.data ?? [])
              .filter((t) => t.enabled)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
          </select>
        </div>
        <div className="sm:w-56">
          <label className="mb-1.5 block text-sm font-medium text-[var(--color-text)]">City</label>
          <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Austin" />
        </div>
      </div>

      {isLoading ? (
        <LoadingState label="Loading coverage…" />
      ) : isError || !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : data.zips.length === 0 ? (
        <EmptyState
          icon={MapIcon}
          title="No coverage data"
          message="No ZIP coverage matches these filters. Try a different trade or city."
        />
      ) : (
        <MarketMapContent zips={data.zips} stats={stats} />
      )}
    </div>
  )
}

function MarketMapContent({
  zips,
  stats,
}: {
  zips: Zip[]
  stats: { coveredCount: number; totalLeads: number; avgFill: number }
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Covered ZIPs" value={formatNumber(stats.coveredCount)} />
        <StatCard label="Avg fill" value={formatPercent(stats.avgFill)} />
        <StatCard label="Total leads" value={formatNumber(stats.totalLeads)} />
      </div>

      <SectionCard title="ZIP coverage" action={<Legend />}>
        <div className="p-5">
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8 lg:grid-cols-10">
            {zips.map((z) => (
              <ZipCell key={z.zip} zip={z} />
            ))}
          </div>
        </div>
      </SectionCard>
    </div>
  )
}

function ZipCell({ zip }: { zip: Zip }) {
  const bg = zip.covered ? 'rgba(22, 163, 74, 0.35)' : 'rgba(148, 163, 184, 0.25)'
  const handleClick = () => {
    if (zip.covered) toast.success(`Drill into ${zip.zip}`)
  }
  return (
    <Tooltip
      content={
        <div className="space-y-0.5">
          <p className="font-medium">ZIP {zip.zip}</p>
          <p>{formatNumber(zip.leads)} leads</p>
          <p>{formatPercent(zip.fill)} fill</p>
          {zip.locked && <p>Locked territory</p>}
        </div>
      }
    >
      <button
        type="button"
        onClick={handleClick}
        aria-label={`ZIP ${zip.zip}`}
        className={cn(
          'relative aspect-square rounded-[6px] border border-[var(--color-border)] transition-transform focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]',
          zip.covered ? 'cursor-pointer hover:scale-105' : 'cursor-default',
        )}
        style={{ backgroundColor: bg }}
      >
        {zip.locked && (
          <span
            className="pointer-events-none absolute inset-0 rounded-[6px] ring-2 ring-inset"
            style={{
              borderColor: 'var(--color-primary)',
              backgroundImage:
                'repeating-linear-gradient(45deg, var(--color-primary) 0, var(--color-primary) 1px, transparent 1px, transparent 5px)',
              opacity: 0.4,
              boxShadow: 'inset 0 0 0 1px var(--color-primary)',
            }}
          />
        )}
      </button>
    </Tooltip>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[12px] text-[var(--color-text-secondary)]">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-[4px] border border-[var(--color-border)]" style={{ backgroundColor: 'rgba(22, 163, 74, 0.35)' }} />
        Covered
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-[4px] border border-[var(--color-border)]" style={{ backgroundColor: 'rgba(148, 163, 184, 0.25)' }} />
        Remaining
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="h-3 w-3 rounded-[4px] ring-2 ring-inset"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, var(--color-primary) 0, var(--color-primary) 1px, transparent 1px, transparent 5px)',
            boxShadow: 'inset 0 0 0 1px var(--color-primary)',
          }}
        />
        Locked
      </span>
    </div>
  )
}
