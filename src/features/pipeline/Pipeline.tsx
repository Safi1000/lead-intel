import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, Play, RefreshCw, Square, Timer } from 'lucide-react'
import { format } from 'date-fns'
import { pipelineApi, pipelineOrgId } from '../../api/pipeline'
import type { PipelineConfig, PipelineRun } from '../../api/pipeline'
import { normalizeError } from '../../api/client'
import { useAuth } from '../../hooks'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { Checkbox } from '../../components/ui/controls'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { sourcingApi } from '../../api/endpoints'
import { PageHeader } from '../shared/bits'
import { SourcingConfig } from './SourcingProfile'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { cn } from '../../lib/utils'

// ---------------------------------------------------------------------------
// Niche info banner
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

/** Live elapsed clock for a run: ticks every second while running, freezes at the final
 * duration once the run completes (uses completed_at when available). */
function ElapsedTimer({ startedAt, completedAt, running }: { startedAt: string; completedAt: string | null; running: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])
  const end = completedAt ? new Date(completedAt).getTime() : running ? now : Date.now()
  const s = Math.max(0, Math.floor((end - new Date(startedAt).getTime()) / 1000))
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60
  const label = hh > 0 ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`
  return (
    <span className="inline-flex items-center gap-1 text-[12px] tabular-nums text-[var(--color-text-secondary)]" title={running ? 'Elapsed time' : 'Total run time'}>
      <Timer className="h-3.5 w-3.5" /> {label}
    </span>
  )
}

function StatusBadge({ status }: { status: PipelineRun['status'] }) {
  const styles: Record<PipelineRun['status'], string> = {
    running:   'bg-[var(--color-primary)]/15 text-[var(--color-primary)] dark:text-[var(--color-primary)]',
    completed: 'bg-green-500/15 text-green-700 dark:text-green-400',
    failed:    'bg-red-500/15 text-red-700 dark:text-red-400',
    stopped:   'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  }
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', styles[status])}>
      {status === 'running' && <RefreshCw className="mr-1 h-3 w-3 animate-spin" />}
      {status}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Run trigger
// ---------------------------------------------------------------------------

/** Superadmin-only: the 8:00 AM (PKT) daily auto-run. Server rejects changes from other roles. */
function DailyRunPanel({ orgId }: { orgId: string }) {
  const qc = useQueryClient()
  const { data: cfg } = useQuery({ queryKey: ['pipeline-config', orgId], queryFn: () => pipelineApi.getConfig(orgId) })
  const [target, setTarget] = useState<string | null>(null) // null = not edited yet

  const save = useMutation({
    mutationFn: (patch: { daily_run_enabled?: boolean; daily_run_target?: number }) =>
      pipelineApi.saveConfig({ ...(cfg as PipelineConfig), ...patch }),
    onSuccess: (_d, patch) => {
      qc.invalidateQueries({ queryKey: ['pipeline-config', orgId] })
      if (patch.daily_run_enabled !== undefined) {
        toast.success(patch.daily_run_enabled ? 'Daily auto-run ON — next run tomorrow 8:00 AM' : 'Daily auto-run OFF')
      } else {
        toast.success('Daily target saved')
      }
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  if (!cfg) return null
  const enabled = !!cfg.daily_run_enabled
  const targetValue = target ?? String(cfg.daily_run_target ?? 50)

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold">Daily auto-run <span className="ml-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-400">Superadmin</span></h2>
          <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">
            Every day at 8:00 AM, automatically create the day's batch (named by date) and run until the qualified target is met. Untick to skip — it stays off until you re-enable it.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div>
            <Label htmlFor="daily-target">Qualified target</Label>
            <Input
              id="daily-target" type="number" min={1} max={1000} className="w-28"
              value={targetValue}
              onChange={(e) => setTarget(e.target.value)}
              onBlur={() => { const n = Number(targetValue); if (n >= 1 && n !== cfg.daily_run_target) save.mutate({ daily_run_target: n }) }}
              disabled={save.isPending}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 pt-5">
            <Checkbox
              checked={enabled}
              onCheckedChange={(v) => save.mutate({ daily_run_enabled: v })}
              disabled={save.isPending}
              aria-label="Daily auto-run"
            />
            <span className={cn('text-sm font-medium', enabled ? 'text-green-700 dark:text-green-400' : 'text-[var(--color-text-muted)]')}>
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
          </label>
        </div>
      </div>
    </Card>
  )
}

// Pre-run cost model (folds in the old Discovery page): metros saturate so the qualify
// rate drifts — a guide, recomputed live as the target changes.
const QUAL_RATE = 0.15
const CREDIT_USD = 0.5 // 1 Lead Credit = 1 qualified lead = $0.50 to the customer

function RunTrigger({ orgId }: { orgId: string }) {
  const qc = useQueryClient()
  const [batchName, setBatchName] = useState('')
  const [qualifiedTarget, setQualifiedTarget] = useState('')
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [liveRun, setLiveRun] = useState<PipelineRun | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }

  // Persist live progress across reloads / navigation / logout: on mount, adopt the org's
  // currently-running run from the server so the progress card + metrics reappear.
  const { data: recentRuns } = useQuery({
    queryKey: ['pipeline-runs', orgId],
    queryFn: () => pipelineApi.listRuns(orgId),
    refetchInterval: 10_000,
  })
  useEffect(() => {
    if (activeRunId) return
    const running = recentRuns?.find((r) => r.status === 'running')
    if (running) { setActiveRunId(running.id); setLiveRun(running) }
  }, [recentRuns, activeRunId])

  const targetN = Math.max(0, Number(qualifiedTarget) || 0)
  const estScanned = Math.round(targetN / QUAL_RATE)
  const estCredits = targetN // 1 Lead Credit per qualified lead

  // Daily lead limit (set per org). A request over it is warned + confirmed before running.
  const { data: sourcingProfile } = useQuery({ queryKey: ['sourcing-profile'], queryFn: () => sourcingApi.get() })
  const dailyLimit = sourcingProfile?.daily_limit ?? 0
  const [confirmOpen, setConfirmOpen] = useState(false)
  const overLimit = dailyLimit > 0 && targetN > dailyLimit
  const startRun = () => { if (overLimit) setConfirmOpen(true); else trigger.mutate() }

  useEffect(() => {
    if (!activeRunId || !orgId) return
    const poll = async () => {
      try {
        const status = await pipelineApi.getStatus(orgId, activeRunId)
        setLiveRun(status)
        if (status.status !== 'running') {
          clearPoll()
          qc.invalidateQueries({ queryKey: ['pipeline-runs', orgId] })
          if (status.status === 'completed') {
            toast.success(`Done! ${status.total_imported} leads imported.`)
          } else {
            toast.error(`Run failed: ${status.error ?? 'unknown error'}`)
          }
        }
      } catch { /* ignore transient polling errors */ }
    }
    poll()
    pollRef.current = setInterval(poll, 3000)
    return clearPoll
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunId, orgId])

  const trigger = useMutation({
    mutationFn: () => pipelineApi.triggerRun({
      org_id: orgId,
      dry_run: false,
      ...(qualifiedTarget ? { qualified_target: Number(qualifiedTarget) } : {}),
      ...(batchName.trim() ? { batch_name: batchName.trim() } : {}),
    }),
    onSuccess: (data) => {
      setActiveRunId(data.run_id)
      setLiveRun(null)
      toast.info('Pipeline started…')
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  const stop = useMutation({
    mutationFn: () => pipelineApi.stopRun({ run_id: activeRunId!, org_id: orgId }),
    onSuccess: () => toast.info('Stop signal sent — the run will finish its current lead then exit.'),
    onError: (e) => toast.error(normalizeError(e).message),
  })

  const isRunning = liveRun?.status === 'running' || trigger.isPending

  return (
    <Card className="p-5">
      <h2 className="mb-4 text-[15px] font-semibold">Trigger run</h2>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <Label htmlFor="batch-name">Batch name</Label>
          <Input
            id="batch-name"
            type="text"
            placeholder="e.g. July Miami spas"
            value={batchName}
            onChange={(e) => setBatchName(e.target.value)}
            className="w-52"
          />
          <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
            All leads from this run land in this batch.
          </p>
        </div>
        <div>
          <Label htmlFor="qualified-target">Qualified Leads</Label>
          <Input
            id="qualified-target"
            type="number"
            min={1}
            placeholder="e.g. 100"
            value={qualifiedTarget}
            onChange={(e) => setQualifiedTarget(e.target.value)}
            className="w-44"
          />
          <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
            Runs until this many importable leads are found (website + no-website batches).
          </p>
        </div>
        <div className="pb-5 flex gap-2">
          <Button onClick={startRun} loading={trigger.isPending} disabled={isRunning}>
            <Play className="h-4 w-4 mr-1.5" />
            {isRunning ? 'Running…' : 'Start run'}
          </Button>
          {isRunning && activeRunId && (
            <Button
              onClick={() => stop.mutate()}
              loading={stop.isPending}
              disabled={stop.isPending}
              className="bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 hover:bg-red-500/15"
            >
              <Square className="h-3.5 w-3.5 mr-1.5 fill-current" />
              Stop
            </Button>
          )}
        </div>
      </div>

      {targetN > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5 text-[13px]">
          <span className="font-medium text-[var(--color-text)]">Estimate · {targetN.toLocaleString()} qualified</span>
          <span className="text-[var(--color-text-secondary)]">Scan ~<strong className="tabular-nums text-[var(--color-text)]">{estScanned.toLocaleString()}</strong> businesses</span>
          <span className="text-[var(--color-text-secondary)]">Cost <strong className="tabular-nums text-[var(--color-primary)]">{estCredits.toLocaleString()} Lead Credits</strong> <span className="text-[var(--color-text-muted)]">≈ ${(estCredits * CREDIT_USD).toFixed(2)}</span></span>
          <span className="text-[12px] text-[var(--color-text-muted)]">updates live · actuals vary with saturation</span>
        </div>
      )}

      {liveRun && (
        <div className={cn(
          'mt-4 rounded-lg border px-4 py-3 text-sm',
          liveRun.status === 'failed' ? 'border-red-200 bg-red-500/10' : 'border-[var(--color-border)] bg-[var(--color-surface-alt)]',
        )}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="font-medium">Current run</span>
            <div className="flex items-center gap-3">
              <ElapsedTimer startedAt={liveRun.started_at} completedAt={liveRun.completed_at} running={liveRun.status === 'running'} />
              <StatusBadge status={liveRun.status} />
            </div>
          </div>
          {liveRun.qualified_target != null && (
            <div className="mb-3">
              <div className="flex justify-between text-[12px] text-[var(--color-text-secondary)] mb-1">
                <span>Qualified leads <span className="text-[var(--color-text-muted)]">(scanned {liveRun.processed_total ?? 0})</span></span>
                <strong className="text-[var(--color-text)]">{liveRun.total_imported ?? 0} / {liveRun.qualified_target}</strong>
              </div>
              <div className="h-1.5 w-full rounded-full bg-[var(--color-border)] overflow-hidden">
                <div
                  className="h-full bg-[var(--color-primary)] transition-all"
                  style={{ width: `${Math.min(100, Math.round(((liveRun.total_imported ?? 0) / liveRun.qualified_target) * 100))}%` }}
                />
              </div>
            </div>
          )}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-5 gap-y-1 text-[12px] text-[var(--color-text-secondary)]">
            <span>Scanned: <strong className="text-[var(--color-text)]">{liveRun.total_searched}</strong></span>
            <span>New: <strong className="text-[var(--color-text)]">{liveRun.total_new}</strong></span>
            <span>Enriched: <strong className="text-[var(--color-text)]">{liveRun.total_enriched}</strong></span>
            <span>Emails: <strong className="text-[var(--color-text)]">{liveRun.total_emailed}</strong></span>
            <span>Imported: <strong className="text-[var(--color-text)]">{liveRun.total_imported}</strong></span>
            <span>No site: <strong className="text-[var(--color-text-secondary)]">{liveRun.total_no_website ?? 0}</strong></span>
          </div>
          {liveRun.error && <p className="mt-2 text-red-600 dark:text-red-400 text-[12px]">{liveRun.error}</p>}
          {liveRun.xlsx_url && (
            <a href={liveRun.xlsx_url} target="_blank" rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[var(--color-primary)] text-[12px] hover:underline">
              <Download className="h-3 w-3" /> Download XLSX
            </a>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Over your daily lead limit"
        message={`Your daily lead limit is ${dailyLimit.toLocaleString()}. This run asks for ${targetN.toLocaleString()}, so only ${dailyLimit.toLocaleString()} leads will be generated today. Proceed anyway?`}
        confirmLabel="Start run"
        loading={trigger.isPending}
        onConfirm={() => { setConfirmOpen(false); trigger.mutate() }}
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Run history table
// ---------------------------------------------------------------------------

function RunHistory({ orgId }: { orgId: string }) {
  const { data: runs = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['pipeline-runs', orgId],
    queryFn: () => pipelineApi.listRuns(orgId),
    refetchInterval: 10_000,
  })

  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState onRetry={() => refetch()} />
  if (runs.length === 0) return (
    <EmptyState icon={Play} title="No runs yet" message="Trigger your first run above." />
  )

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-[var(--color-border)] px-5 py-3">
        <span className="text-[15px] font-semibold">Run history</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[12px] text-[var(--color-text-secondary)]">
              <th className="px-5 py-2.5 font-medium">Started</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium">Mode</th>
              <th className="px-3 py-2.5 font-medium">Scanned</th>
              <th className="px-3 py-2.5 font-medium">New</th>
              <th className="px-3 py-2.5 font-medium">Enriched</th>
              <th className="px-3 py-2.5 font-medium">Emails</th>
              <th className="px-3 py-2.5 font-medium">Imported</th>
              <th className="px-3 py-2.5 font-medium">No site</th>
              <th className="px-3 py-2.5 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r: PipelineRun) => <RunRow key={r.id} run={r} orgId={orgId} />)}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

const EDGE_FUNCTION_TIMEOUT_MS = 5 * 60 * 1000 // 5 min — safe margin above 150s hard limit

function RunRow({ run, orgId }: { run: PipelineRun; orgId: string }) {
  const qc = useQueryClient()
  const [xlsxUrl, setXlsxUrl] = useState<string | null>(null)
  const [loadingXlsx, setLoadingXlsx] = useState(false)

  // If a run looks stuck (status=running but started >5 min ago), call getStatus which
  // auto-marks it failed server-side, then refresh the list.
  useEffect(() => {
    if (run.status !== 'running') return
    const age = Date.now() - new Date(run.started_at).getTime()
    if (age < EDGE_FUNCTION_TIMEOUT_MS) return
    pipelineApi.getStatus(orgId, run.id)
      .then(() => qc.invalidateQueries({ queryKey: ['pipeline-runs', orgId] }))
      .catch(() => {/* ignore */})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id, run.status])

  const downloadXlsx = async () => {
    if (xlsxUrl) { window.open(xlsxUrl, '_blank'); return }
    setLoadingXlsx(true)
    try {
      const status = await pipelineApi.getStatus(orgId, run.id)
      if (status.xlsx_url) { setXlsxUrl(status.xlsx_url); window.open(status.xlsx_url, '_blank') }
      else toast.error('No XLSX for this run.')
    } catch { toast.error('Could not load download link.') }
    finally { setLoadingXlsx(false) }
  }

  const stop = useMutation({
    mutationFn: () => pipelineApi.stopRun({ run_id: run.id, org_id: orgId }),
    onSuccess: () => {
      toast.info('Stop signal sent — run will exit after the current lead.')
      qc.invalidateQueries({ queryKey: ['pipeline-runs', orgId] })
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  return (
    <tr className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]">
      <td className="px-5 py-3">{format(new Date(run.started_at), 'MMM d, HH:mm')}</td>
      <td className="px-3 py-3"><StatusBadge status={run.status} /></td>
      <td className="px-3 py-3 text-[var(--color-text-secondary)]">{run.dry_run ? 'Dry run' : 'Live'}</td>
      <td className="px-3 py-3 tabular-nums">{run.total_searched}</td>
      <td className="px-3 py-3 tabular-nums">{run.total_new}</td>
      <td className="px-3 py-3 tabular-nums">{run.total_enriched}</td>
      <td className="px-3 py-3 tabular-nums">{run.total_emailed}</td>
      <td className="px-3 py-3 tabular-nums font-medium">{run.total_imported}</td>
      <td className="px-3 py-3 tabular-nums text-[var(--color-text-secondary)]">{run.total_no_website ?? 0}</td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <button onClick={() => stop.mutate()} disabled={stop.isPending}
            className="inline-flex items-center gap-1 text-red-500 hover:text-red-700 dark:text-red-400 text-[12px] disabled:opacity-40"
            title="Force stop">
            <Square className="h-3 w-3 fill-current" />
            {stop.isPending ? '…' : 'Stop'}
          </button>
          {run.xlsx_path && (
            <button onClick={downloadXlsx} disabled={loadingXlsx}
              className="inline-flex items-center gap-1 text-[var(--color-primary)] hover:underline text-[12px] disabled:opacity-50">
              <Download className="h-3.5 w-3.5" />
              {loadingXlsx ? '…' : 'XLSX'}
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/** Unified Sourcing workspace: niche/area/checks config → live cost → run + persistent progress. */
export function SourcingWorkspace() {
  const orgId = pipelineOrgId()
  const { role } = useAuth()

  if (!orgId) {
    return (
      <div className="reveal">
        <PageHeader title="Sourcing" subtitle="Set your niche and area, preview the cost, then run the pipeline." />
        <Card className="p-8 text-center text-[var(--color-text-secondary)]">
          No organisation selected. Enter an org from the Organizations page first.
        </Card>
      </div>
    )
  }

  return (
    <div className="reveal flex flex-col gap-6">
      <PageHeader title="Sourcing" subtitle="Set your niche and area, preview the cost, then run the pipeline." />
      <SourcingConfig />
      {(role === 'superadmin' || role === 'owner') && <DailyRunPanel orgId={orgId} />}
      <RunTrigger orgId={orgId} />
      <RunHistory orgId={orgId} />
    </div>
  )
}
