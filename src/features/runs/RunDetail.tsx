import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Download, ListChecks, RefreshCw, XCircle } from 'lucide-react'
import { runsApi } from '../../api/endpoints'
import { useRunProgress } from '../../hooks'
import { ACTIVE_RUN_STATUSES } from '../../config/constants'
import { formatNumber, formatPercent } from '../../lib/utils'
import { absoluteTime, etaLabel, relativeTime } from '../../lib/time'
import { Button, Card } from '../../components/ui/primitives'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader, StatusBadge, ProgressBar } from '../shared/bits'
import { cn } from '../../lib/utils'

const STAGE_ICON = { done: CheckCircle2, running: RefreshCw, failed: XCircle, pending: null } as const

export function RunDetailPage({ admin = false }: { admin?: boolean }) {
  const { runId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: run, isLoading, isError, refetch } = useRunProgress(runId, admin)
  const [cancelOpen, setCancelOpen] = useState(false)

  const cancel = useMutation({
    mutationFn: () => runsApi.cancel(runId as string),
    onSuccess: () => {
      toast.success('Run cancelled')
      qc.invalidateQueries({ queryKey: ['run', runId] })
    },
  })
  const rerun = useMutation({
    mutationFn: (mode: 'full' | 'failed') => runsApi.rerun(runId as string, mode),
    onSuccess: (fresh) => {
      toast.success('Re-run launched')
      navigate(`/runs/${fresh.id}`)
    },
  })

  if (isLoading) return <LoadingState label="Loading run…" />
  if (isError || !run) return <ErrorState message="Run not found." onRetry={() => refetch()} />

  const isActive = ACTIVE_RUN_STATUSES.includes(run.status)
  const recentLeads = (run.leads_enriched ?? 0) > 0

  return (
    <div>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">Roofing · {run.location_label} <StatusBadge status={run.status} /></span>}
        subtitle={<span title={absoluteTime(run.created_at)}>Started {relativeTime(run.started_at ?? run.created_at)} by {run.started_by}</span>}
        actions={
          <>
            <Link to={`/runs/${run.id}/leads`}>
              <Button variant="outline" disabled={run.leads_found === 0}><ListChecks className="h-4 w-4" /> View Leads</Button>
            </Link>
            {run.status === 'completed' && <Link to="/exports"><Button><Download className="h-4 w-4" /> Export</Button></Link>}
            {isActive && <Button variant="danger" onClick={() => setCancelOpen(true)}>Cancel</Button>}
            {(run.status === 'failed' || run.status === 'partial' || run.status === 'completed') && (
              <Button variant="outline" loading={rerun.isPending} onClick={() => rerun.mutate(run.status === 'failed' ? 'failed' : 'full')}>
                <RefreshCw className="h-4 w-4" /> Re-run
              </Button>
            )}
          </>
        }
      />

      {/* Status banners */}
      {run.status === 'failed' && (
        <Banner tone="error" icon={XCircle} title="Run failed">
          {run.error_reason} <button className="font-medium underline" onClick={() => rerun.mutate('failed')}>Re-run failed stages</button> or{' '}
          <a className="font-medium underline" href="mailto:support@techexcel.io">contact support</a>.
        </Banner>
      )}
      {run.status === 'partial' && (
        <Banner tone="warn" icon={AlertTriangle} title="Partially completed">
          Some stages failed ({run.failed_stages?.join(', ')}). Delivered leads are available below; re-run to attempt the rest.
        </Banner>
      )}
      {run.status === 'completed' && (
        <Banner tone="success" icon={CheckCircle2} title="Run completed">
          {formatNumber(run.leads_found)} leads enriched. View leads or export your batch.
        </Banner>
      )}

      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        {/* Progress */}
        <Card className="lg:col-span-2">
          <div className="border-b border-[var(--color-border)] px-5 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-semibold">Live progress</h2>
              <span className="text-sm tabular-nums text-[var(--color-text-secondary)]" aria-live="polite">
                {run.status === 'queued' ? 'Waiting to start…' : `${Math.round(run.progress * 100)}%`}
              </span>
            </div>
            <div className="mt-3"><ProgressBar value={run.progress} /></div>
            {isActive && run.eta_seconds != null && (
              <p className="mt-2 text-[13px] text-[var(--color-text-muted)]">Est. completion {etaLabel(run.eta_seconds)} · auto-refreshing every 5s</p>
            )}
          </div>
          <ul className="divide-y divide-[var(--color-border)]">
            {run.stages.map((s) => {
              const Ic = STAGE_ICON[s.status]
              return (
                <li key={s.stage} className="flex items-center gap-3 px-5 py-3">
                  <span className={cn('flex h-6 w-6 items-center justify-center rounded-full', s.status === 'done' ? 'text-[var(--c-verified)]' : s.status === 'running' ? 'text-[var(--color-primary)]' : s.status === 'failed' ? 'text-[var(--c-unverified)]' : 'text-[var(--color-text-muted)]')}>
                    {Ic ? <Ic className={cn('h-5 w-5', s.status === 'running' && 'animate-spin')} /> : <span className="h-2 w-2 rounded-full bg-current" />}
                  </span>
                  <span className={cn('flex-1 text-sm', s.status === 'pending' ? 'text-[var(--color-text-muted)]' : 'font-medium')}>{s.stage}</span>
                  {s.status === 'running' && <span className="text-[12px] tabular-nums text-[var(--color-text-muted)]">{s.pct}%</span>}
                  {s.status === 'done' && <span className="text-[12px] text-[var(--c-verified)]">Done</span>}
                  {s.status === 'failed' && <span className="text-[12px] text-[var(--c-unverified)]">Failed</span>}
                </li>
              )
            })}
          </ul>
        </Card>

        {/* Side stats */}
        <div className="space-y-4">
          <Card className="p-5">
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Leads found" value={formatNumber(run.leads_found)} />
              <Stat label="Enriched" value={formatNumber(run.leads_enriched)} />
            </div>
          </Card>
          <Card>
            <div className="border-b border-[var(--color-border)] px-5 py-3"><h3 className="text-sm font-semibold">Fill rate so far</h3></div>
            <div className="space-y-2.5 p-5">
              {run.fill_rate ? (
                ([
                  ['Business phone', run.fill_rate.business_phone],
                  ['Owner phone', run.fill_rate.owner_phone],
                  ['Email', run.fill_rate.business_email],
                  ['Website', run.fill_rate.website],
                ] as const).map(([k, v]) => (
                  <div key={k}>
                    <div className="mb-1 flex items-center justify-between text-[13px]">
                      <span className="text-[var(--color-text-secondary)]">{k}</span>
                      <span className="font-medium tabular-nums">{formatPercent(v)}</span>
                    </div>
                    <ProgressBar value={v} className="h-1.5" />
                  </div>
                ))
              ) : (
                <p className="text-[13px] text-[var(--color-text-muted)]">{isActive ? 'Fill rate appears as leads enrich.' : 'No fill data.'}</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Live feed */}
      <Card className="mt-6">
        <div className="border-b border-[var(--color-border)] px-5 py-3"><h2 className="text-[16px] font-semibold">Recent leads</h2></div>
        {!recentLeads ? (
          <p className="px-5 py-8 text-center text-sm text-[var(--color-text-muted)]">{isActive ? 'Leads will appear here as they’re enriched.' : 'No leads in this run.'}</p>
        ) : (
          <div className="p-5">
            <p className="text-sm text-[var(--color-text-secondary)]">{formatNumber(run.leads_enriched)} leads enriched.{' '}
              <Link to={`/runs/${run.id}/leads`} className="font-medium text-[var(--color-primary)] hover:underline">Open the full lead list →</Link>
            </p>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this run?"
        message="Enrichment will stop. Leads already enriched remain available, but the run can’t be resumed."
        confirmLabel="Cancel run"
        destructive
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-[24px] font-bold tabular-nums">{value}</p>
    </div>
  )
}

function Banner({ tone, icon: Icon, title, children }: { tone: 'error' | 'warn' | 'success'; icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  const map = {
    error: 'border-red-200 bg-red-50 text-[var(--c-unverified-text)]',
    warn: 'border-amber-200 bg-amber-50 text-amber-800',
    success: 'border-green-200 bg-green-50 text-green-800',
  }
  return (
    <div className={cn('mt-4 flex items-start gap-3 rounded-[12px] border p-4 text-sm', map[tone])}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div><p className="font-semibold">{title}</p><p className="mt-0.5">{children}</p></div>
    </div>
  )
}
