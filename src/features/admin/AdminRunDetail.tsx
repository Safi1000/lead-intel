import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Pause, Play, RefreshCw, Terminal, XCircle } from 'lucide-react'
import { adminApi, runsApi } from '../../api/endpoints'
import { useRunProgress } from '../../hooks'
import { ACTIVE_RUN_STATUSES } from '../../config/constants'
import { formatMoney, formatNumber } from '../../lib/utils'
import { absoluteTime } from '../../lib/time'
import { Button, Card } from '../../components/ui/primitives'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader, StatusBadge, ProgressBar } from '../shared/bits'

type OverrideAction = 'pause' | 'resume' | 'cancel' | null

export function AdminRunDetailPage() {
  const { runId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: run, isLoading, isError, refetch } = useRunProgress(runId, true)
  const [action, setAction] = useState<OverrideAction>(null)

  const override = useMutation({
    mutationFn: (vars: { action: string; reason: string }) => adminApi.override(runId as string, vars),
    onSuccess: () => { toast.success('Override applied — written to audit log'); qc.invalidateQueries({ queryKey: ['run', runId] }); setAction(null) },
  })
  const rerun = useMutation({
    mutationFn: (mode: 'full' | 'failed') => runsApi.rerun(runId as string, mode),
    onSuccess: (fresh) => { toast.success('Re-run launched'); navigate(`/admin/runs/${fresh.id}`) },
  })

  if (isLoading) return <LoadingState />
  if (isError || !run) return <ErrorState message="Run not found." onRetry={() => refetch()} />

  const isActive = ACTIVE_RUN_STATUSES.includes(run.status)

  return (
    <div>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{run.client_name} · Roofing <StatusBadge status={run.status} /></span>}
        subtitle={<Link to="/admin/runs" className="text-[var(--color-admin)] hover:underline">← All runs</Link>}
        actions={
          <>
            {run.status === 'running' && <Button variant="outline" onClick={() => setAction('pause')}><Pause className="h-4 w-4" /> Pause</Button>}
            {run.status === 'paused' && <Button variant="outline" onClick={() => setAction('resume')}><Play className="h-4 w-4" /> Resume</Button>}
            {isActive && <Button variant="danger" onClick={() => setAction('cancel')}><XCircle className="h-4 w-4" /> Cancel</Button>}
            <Button variant="outline" loading={rerun.isPending} onClick={() => rerun.mutate('failed')}><RefreshCw className="h-4 w-4" /> Re-run failed</Button>
            <Button variant="ghost" loading={rerun.isPending} onClick={() => rerun.mutate('full')}>Re-run full</Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="border-b border-[var(--color-border)] px-5 py-4">
            <div className="flex items-center justify-between"><h2 className="text-[16px] font-semibold">Progress</h2><span className="text-sm tabular-nums">{Math.round(run.progress * 100)}%</span></div>
            <div className="mt-3"><ProgressBar value={run.progress} /></div>
          </div>
          <ul className="divide-y divide-[var(--color-border)]">
            {run.stages.map((s) => (
              <li key={s.stage} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <span className={s.status === 'pending' ? 'text-[var(--color-text-muted)]' : 'font-medium'}>{s.stage}</span>
                <span className="text-[12px] tabular-nums text-[var(--color-text-secondary)]">{s.status === 'done' ? 'done' : s.status === 'running' ? `${s.pct}%` : s.status === 'failed' ? 'failed' : 'pending'}</span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold">Run economics</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <Row k="Cost so far" v={formatMoney(run.cost_cents)} />
              <Row k="Leads found" v={formatNumber(run.leads_found)} />
              <Row k="Leads enriched" v={formatNumber(run.leads_enriched)} />
              <Row k="Created" v={absoluteTime(run.created_at)} />
            </dl>
          </Card>

          <Card className="p-5">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Terminal className="h-4 w-4" /> Per-API calls</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <Row k="Places" v="120 calls" />
              <Row k="SkipTrace" v="80 calls" />
              <Row k="Email verify" v="200 calls" />
              <Row k="LLM" v="60 calls" />
            </dl>
          </Card>
        </div>
      </div>

      {/* Raw errors / stage logs */}
      <Card className="mt-6">
        <div className="border-b border-[var(--color-border)] px-5 py-3"><h2 className="text-[16px] font-semibold">Raw stage log</h2></div>
        <pre className="scrollbar-thin max-h-64 overflow-auto bg-slate-900 p-4 text-[12px] leading-relaxed text-slate-100">
{`[discovery] grid 12x12 generated · 144 cells
[discovery] 248 candidate businesses found
[owner-id] matched 188 owners via SoS + GBP
[contact] skip-trace batch 1/3 ok
${run.status === 'failed' ? '[contact] skip-trace batch 2/3 ERR 429 — backoff exhausted\n[run] marked FAILED' : '[contact] skip-trace batch 2/3 ok'}
[verify] email verifier: 200 checked, 142 deliverable
[package] writing lead_fields with provenance`}
        </pre>
      </Card>

      <ConfirmDialog
        open={action !== null}
        onOpenChange={(o) => !o && setAction(null)}
        title={`${action ? action[0].toUpperCase() + action.slice(1) : ''} run?`}
        message="This override is logged to the audit trail with your reason."
        confirmLabel={`Confirm ${action ?? ''}`}
        destructive={action === 'cancel'}
        requireReason
        loading={override.isPending}
        onConfirm={(reason) => override.mutate({ action: action as string, reason: reason ?? '' })}
      />
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-[var(--color-text-secondary)]">{k}</dt>
      <dd className="font-medium tabular-nums">{v}</dd>
    </div>
  )
}
