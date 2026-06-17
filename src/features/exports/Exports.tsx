import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react'
import { batchesApi, exportsApi } from '../../api/endpoints'
import { POLL_INTERVAL_MS } from '../../config/constants'
import { relativeTime } from '../../lib/time'
import { formatNumber, cn } from '../../lib/utils'
import { Button, Card } from '../../components/ui/primitives'
import { Checkbox } from '../../components/ui/controls'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader, SectionCard } from '../shared/bits'

const EXPORT_COLUMNS = ['Business', 'Owner name', 'Owner phone', 'Business phone', 'Email', 'Website', 'Confidence']

export function ExportsPage() {
  const qc = useQueryClient()
  const [format, setFormat] = useState<'csv' | 'xlsx'>('csv')
  const [cols, setCols] = useState<Set<string>>(new Set(EXPORT_COLUMNS))
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const [batchId, setBatchId] = useState<string>('')

  const batches = useQuery({ queryKey: ['batches'], queryFn: batchesApi.list })
  const jobs = useQuery({
    queryKey: ['exports'],
    queryFn: exportsApi.list,
    refetchInterval: (q) => (q.state.data?.data.some((j) => j.status === 'processing' || j.status === 'queued') ? POLL_INTERVAL_MS / 2.5 : false),
  })

  const create = useMutation({
    mutationFn: () =>
      exportsApi.create({
        batch_id: batchId || batches.data?.data[0]?.id,
        format,
        columns: [...cols],
        confidence_filter: verifiedOnly ? 'verified,probable' : undefined,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exports'] }),
  })

  return (
    <div>
      <PageHeader title="Exports &amp; Delivery" subtitle="Generate CSV/Excel exports and re-download recent files." />

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-2">
          <h2 className="text-[16px] font-semibold">New export</h2>

          <div className="mt-4 space-y-4">
            <div>
              <p className="mb-1.5 text-sm font-medium">Source batch</p>
              {batches.isLoading ? (
                <div className="h-9 animate-pulse rounded-[8px] bg-slate-100" />
              ) : (
                <select value={batchId} onChange={(e) => setBatchId(e.target.value)} className="h-9 w-full rounded-[8px] border border-[var(--color-border)] px-2 text-sm">
                  <option value="">Most recent batch</option>
                  {(batches.data?.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>Roofing · {b.location_label} ({b.lead_count})</option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <p className="mb-1.5 text-sm font-medium">Format</p>
              <div className="flex gap-2">
                {(['csv', 'xlsx'] as const).map((f) => (
                  <button key={f} onClick={() => setFormat(f)} className={cn('flex flex-1 items-center justify-center gap-2 rounded-[8px] border py-2 text-sm font-medium', format === f ? 'border-[var(--color-primary)] bg-blue-50 text-[var(--color-primary)]' : 'border-[var(--color-border)]')}>
                    {f === 'csv' ? <FileText className="h-4 w-4" /> : <FileSpreadsheet className="h-4 w-4" />}{f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-sm font-medium">Columns</p>
              <div className="grid grid-cols-2 gap-2">
                {EXPORT_COLUMNS.map((c) => (
                  <label key={c} className="flex items-center gap-2 text-[13px]">
                    <Checkbox checked={cols.has(c)} onCheckedChange={(v) => { const n = new Set(cols); v ? n.add(c) : n.delete(c); setCols(n) }} aria-label={c} />
                    {c}
                  </label>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={verifiedOnly} onCheckedChange={setVerifiedOnly} aria-label="Verified and probable only" />
              Only Verified + Probable
            </label>

            <Button className="w-full" loading={create.isPending} onClick={() => create.mutate()} disabled={(batches.data?.data.length ?? 0) === 0}>
              <Download className="h-4 w-4" /> Generate export
            </Button>
            <p className="text-[12px] text-[var(--color-text-muted)]">Push to CRM and WhatsApp digest delivery arrive in Phase 2.</p>
          </div>
        </Card>

        <div className="lg:col-span-3">
          <SectionCard title="Recent exports">
            {jobs.isLoading ? (
              <LoadingState />
            ) : jobs.isError ? (
              <ErrorState onRetry={() => jobs.refetch()} />
            ) : (jobs.data?.data.length ?? 0) === 0 ? (
              <EmptyState icon={Download} title="No exports yet" message="Generate your first export from a delivered batch." />
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {jobs.data!.data.map((j) => (
                  <li key={j.id} className="flex items-center gap-3 px-5 py-3.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100">
                      {j.format === 'csv' ? <FileText className="h-4 w-4" /> : <FileSpreadsheet className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{j.label} · {j.format.toUpperCase()}</p>
                      <p className="text-[12px] text-[var(--color-text-muted)]">{formatNumber(j.row_count)} rows · {relativeTime(j.created_at)}</p>
                    </div>
                    {j.status === 'ready' && j.download_url ? (
                      <a href={j.download_url} download={`${j.label}.${j.format}`}>
                        <Button size="sm" variant="outline"><Download className="h-4 w-4" /> Download</Button>
                      </a>
                    ) : j.status === 'failed' ? (
                      <span className="text-[13px] text-[var(--c-unverified)]">Failed</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-text-muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Processing</span>
                    )}
                    {j.status === 'ready' && <CheckCircle2 className="h-4 w-4 text-[var(--c-verified)]" />}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
