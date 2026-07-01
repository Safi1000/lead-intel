import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, Play, Plus, RefreshCw, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { pipelineApi, pipelineOrgId } from '../../api/pipeline'
import type { PipelineConfig, PipelineRun, PipelineSearch } from '../../api/pipeline'
import { normalizeError } from '../../api/client'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import { cn } from '../../lib/utils'

// ---------------------------------------------------------------------------
// Searches panel
// ---------------------------------------------------------------------------

function SearchesPanel({ orgId }: { orgId: string }) {
  const qc = useQueryClient()
  const [term, setTerm] = useState('')
  const [loc, setLoc] = useState('')

  const { data: searches = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['pipeline-searches', orgId],
    queryFn: () => pipelineApi.listSearches(orgId),
  })

  const add = useMutation({
    mutationFn: () => pipelineApi.addSearch({ org_id: orgId, search_term: term.trim(), location: loc.trim() }),
    onSuccess: () => {
      toast.success('Search added')
      setTerm(''); setLoc('')
      qc.invalidateQueries({ queryKey: ['pipeline-searches', orgId] })
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => pipelineApi.toggleSearch(id, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pipeline-searches', orgId] }),
    onError: (e) => toast.error(normalizeError(e).message),
  })

  const del = useMutation({
    mutationFn: (id: string) => pipelineApi.deleteSearch(id),
    onSuccess: () => {
      toast.success('Removed')
      qc.invalidateQueries({ queryKey: ['pipeline-searches', orgId] })
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState onRetry={() => refetch()} />

  return (
    <Card className="p-5 flex flex-col gap-4">
      <h2 className="text-[15px] font-semibold">Search queries</h2>

      {searches.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">No searches yet. Add one below.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {searches.map((s: PipelineSearch) => (
            <li key={s.id} className={cn('flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm', !s.enabled && 'opacity-50')}>
              <span className="flex-1 min-w-0">
                <span className="font-medium truncate block">{s.search_term}</span>
                <span className="text-[var(--color-text-secondary)] truncate block">{s.location}</span>
              </span>
              <button
                onClick={() => toggle.mutate({ id: s.id, enabled: !s.enabled })}
                className="text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors"
                title={s.enabled ? 'Disable' : 'Enable'}
              >
                {s.enabled ? <ToggleRight className="h-5 w-5 text-[var(--color-primary)]" /> : <ToggleLeft className="h-5 w-5" />}
              </button>
              <button
                onClick={() => del.mutate(s.id)}
                className="text-[var(--color-text-secondary)] hover:text-red-500 transition-colors"
                title="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-[var(--color-border)] pt-4 flex flex-col gap-2">
        <p className="text-[12px] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">Add search</p>
        <Input
          placeholder='Search term, e.g. "dental clinics"'
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <Input
          placeholder='Location, e.g. "Karachi, Pakistan"'
          value={loc}
          onChange={(e) => setLoc(e.target.value)}
        />
        <Button
          onClick={() => add.mutate()}
          loading={add.isPending}
          disabled={!term.trim() || !loc.trim()}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Config panel
// ---------------------------------------------------------------------------

function ConfigPanel({ orgId }: { orgId: string }) {
  const qc = useQueryClient()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['pipeline-config', orgId],
    queryFn: () => pipelineApi.getConfig(orgId),
  })

  const [rubric, setRubric] = useState('')
  const [threshold, setThreshold] = useState('6')
  const [model, setModel] = useState('gpt-4o-mini')

  useEffect(() => {
    if (data) {
      setRubric(data.icp_rubric ?? '')
      setThreshold(String(data.quality_threshold ?? 6))
      setModel(data.openai_model ?? 'gpt-4o-mini')
    }
  }, [data])

  const save = useMutation({
    mutationFn: () => pipelineApi.saveConfig({
      org_id: orgId,
      icp_rubric: rubric,
      quality_threshold: Math.max(1, Math.min(10, Number(threshold) || 6)),
      max_places_per_run: data?.max_places_per_run ?? 100,
      openai_model: model,
    } satisfies PipelineConfig),
    onSuccess: () => {
      toast.success('Config saved')
      qc.invalidateQueries({ queryKey: ['pipeline-config', orgId] })
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState onRetry={() => refetch()} />

  return (
    <Card className="p-5 flex flex-col gap-4">
      <h2 className="text-[15px] font-semibold">ICP config</h2>

      <div>
        <Label htmlFor="rubric">ICP rubric</Label>
        <textarea
          id="rubric"
          rows={5}
          className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] resize-y"
          placeholder="Describe your ideal customer. E.g. B2B service businesses with 5+ employees and recurring clients…"
          value={rubric}
          onChange={(e) => setRubric(e.target.value)}
        />
        <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Sent verbatim to the AI — edit without deploying code.</p>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <Label htmlFor="threshold">Min quality score (1–10)</Label>
          <Input id="threshold" type="number" min={1} max={10} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Leads below this are flagged low-fit.</p>
        </div>
        <div className="flex-1">
          <Label htmlFor="model">AI model</Label>
          <select
            id="model"
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="gpt-4o-mini">gpt-4o-mini (fast, cheap)</option>
            <option value="gpt-4o">gpt-4o (higher quality)</option>
          </select>
        </div>
      </div>

      <Button onClick={() => save.mutate()} loading={save.isPending} className="self-start">Save config</Button>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: PipelineRun['status'] }) {
  const styles = {
    running: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  }
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', styles[status])}>
      {status === 'running' && <RefreshCw className="mr-1 h-3 w-3 animate-spin" />}
      {status}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Run trigger panel
// ---------------------------------------------------------------------------

function RunTrigger({ orgId }: { orgId: string }) {
  const qc = useQueryClient()
  const [maxLeads, setMaxLeads] = useState('')
  const [dryRun, setDryRun] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [liveRun, setLiveRun] = useState<PipelineRun | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }

  useEffect(() => {
    if (!activeRunId || !orgId) return
    const poll = async () => {
      try {
        const status = await pipelineApi.getStatus(orgId, activeRunId)
        setLiveRun(status)
        if (status.status !== 'running') {
          clearPoll()
          qc.invalidateQueries({ queryKey: ['pipeline-runs', orgId] })
          if (status.status === 'completed') toast.success(dryRun ? 'Dry run complete — check run history.' : `Done! ${status.total_imported} leads imported.`)
          else toast.error(`Run failed: ${status.error ?? 'unknown error'}`)
        }
      } catch {
        /* ignore transient errors during polling */
      }
    }
    poll()
    pollRef.current = setInterval(poll, 3000)
    return clearPoll
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunId, orgId])

  const trigger = useMutation({
    mutationFn: () => pipelineApi.triggerRun({
      org_id: orgId,
      dry_run: dryRun,
      ...(maxLeads ? { max_places: Number(maxLeads) } : {}),
    }),
    onSuccess: (data) => {
      setActiveRunId(data.run_id)
      setLiveRun(null)
      toast.info(dryRun ? 'Dry run started…' : 'Pipeline started…')
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  const isRunning = liveRun?.status === 'running' || trigger.isPending

  return (
    <Card className="p-5">
      <h2 className="mb-4 text-[15px] font-semibold">Trigger run</h2>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <Label htmlFor="max-leads">Max leads this run</Label>
          <Input
            id="max-leads"
            type="number"
            min={1}
            placeholder="Use config default"
            value={maxLeads}
            onChange={(e) => setMaxLeads(e.target.value)}
            className="w-44"
          />
          <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Overrides the saved default for this run only.</p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer pb-5">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-primary)]"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
          />
          <span className="text-sm text-[var(--color-text)]">Dry run</span>
          <span className="text-[11px] text-[var(--color-text-muted)]">(no leads imported)</span>
        </label>
        <div className="pb-5">
          <Button
            onClick={() => trigger.mutate()}
            loading={isRunning}
            disabled={isRunning}
            className="flex items-center gap-2"
          >
            <Play className="h-4 w-4" />
            {isRunning ? 'Running…' : 'Start run'}
          </Button>
        </div>
      </div>

      {liveRun && (
        <div className={cn('mt-4 rounded-lg border px-4 py-3 text-sm', liveRun.status === 'failed' ? 'border-red-200 bg-red-50' : 'border-[var(--color-border)] bg-[var(--color-surface-alt)]')}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="font-medium">Current run</span>
            <StatusBadge status={liveRun.status} />
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-x-6 gap-y-1 text-[var(--color-text-secondary)]">
            <span>Searched: <strong className="text-[var(--color-text)]">{liveRun.total_searched}</strong></span>
            <span>New: <strong className="text-[var(--color-text)]">{liveRun.total_new}</strong></span>
            <span>Enriched: <strong className="text-[var(--color-text)]">{liveRun.total_enriched}</strong></span>
            <span>Emails: <strong className="text-[var(--color-text)]">{liveRun.total_emailed}</strong></span>
            <span>Imported: <strong className="text-[var(--color-text)]">{liveRun.total_imported}</strong></span>
          </div>
          {liveRun.error && <p className="mt-2 text-red-600 text-[12px]">{liveRun.error}</p>}
          {liveRun.xlsx_url && (
            <a href={liveRun.xlsx_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[var(--color-primary)] text-[12px] hover:underline">
              <Download className="h-3 w-3" /> Download XLSX
            </a>
          )}
        </div>
      )}
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
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-text-secondary)]">
              <th className="px-5 py-2.5 font-medium">Started</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium">Mode</th>
              <th className="px-3 py-2.5 font-medium">Searched</th>
              <th className="px-3 py-2.5 font-medium">New</th>
              <th className="px-3 py-2.5 font-medium">Enriched</th>
              <th className="px-3 py-2.5 font-medium">Emails</th>
              <th className="px-3 py-2.5 font-medium">Imported</th>
              <th className="px-3 py-2.5 font-medium">XLSX</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r: PipelineRun) => (
              <RunRow key={r.id} run={r} orgId={orgId} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function RunRow({ run, orgId }: { run: PipelineRun; orgId: string }) {
  const [xlsxUrl, setXlsxUrl] = useState<string | null>(null)
  const [loadingXlsx, setLoadingXlsx] = useState(false)

  const downloadXlsx = async () => {
    if (xlsxUrl) { window.open(xlsxUrl, '_blank'); return }
    setLoadingXlsx(true)
    try {
      const status = await pipelineApi.getStatus(orgId, run.id)
      if (status.xlsx_url) { setXlsxUrl(status.xlsx_url); window.open(status.xlsx_url, '_blank') }
      else toast.error('No XLSX available for this run.')
    } catch {
      toast.error('Could not load download link.')
    } finally {
      setLoadingXlsx(false)
    }
  }

  return (
    <tr className="border-b border-[var(--color-border)] last:border-0 hover:bg-slate-50">
      <td className="px-5 py-3 text-[var(--color-text)]">
        {format(new Date(run.started_at), 'MMM d, HH:mm')}
      </td>
      <td className="px-3 py-3"><StatusBadge status={run.status} /></td>
      <td className="px-3 py-3 text-[var(--color-text-secondary)]">{run.dry_run ? 'Dry run' : 'Live'}</td>
      <td className="px-3 py-3 tabular-nums">{run.total_searched}</td>
      <td className="px-3 py-3 tabular-nums">{run.total_new}</td>
      <td className="px-3 py-3 tabular-nums">{run.total_enriched}</td>
      <td className="px-3 py-3 tabular-nums">{run.total_emailed}</td>
      <td className="px-3 py-3 tabular-nums">{run.total_imported}</td>
      <td className="px-3 py-3">
        {run.xlsx_path ? (
          <button
            onClick={downloadXlsx}
            disabled={loadingXlsx}
            className="inline-flex items-center gap-1 text-[var(--color-primary)] hover:underline text-[12px] disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {loadingXlsx ? 'Loading…' : 'Download'}
          </button>
        ) : (
          <span className="text-[var(--color-text-muted)] text-[12px]">—</span>
        )}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function PipelinePage() {
  const orgId = pipelineOrgId()

  if (!orgId) {
    return (
      <div className="reveal">
        <PageHeader title="Lead Pipeline" subtitle="Automated Google Maps lead sourcing." />
        <Card className="p-8 text-center text-[var(--color-text-secondary)]">
          No organisation selected. Enter an org from the Organizations page first.
        </Card>
      </div>
    )
  }

  return (
    <div className="reveal flex flex-col gap-6">
      <PageHeader
        title="Lead Pipeline"
        subtitle="Search Google Maps, enrich with AI, and import directly into the lead queue."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <SearchesPanel orgId={orgId} />
        <ConfigPanel orgId={orgId} />
      </div>

      <RunTrigger orgId={orgId} />
      <RunHistory orgId={orgId} />
    </div>
  )
}
