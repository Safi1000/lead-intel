import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { Archive, ArchiveRestore, Download, FileSpreadsheet, FileUp, Layers, Search, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { assignmentApi, leadBatchesApi, manualLeadsApi, usersApi } from '../../api/endpoints'
import { exportLeadsToXlsx } from './exportBatch'
import { normalizeError } from '../../api/client'
import { useAuth, useDebounce } from '../../hooks'
import { Button, Card, Input } from '../../components/ui/primitives'
import { Select } from '../../components/ui/controls'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader, StatCard } from '../shared/bits'
import { cn } from '../../lib/utils'
import type { LeadBatch } from '../../api/types'

export function BatchesPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { role } = useAuth()
  const isGenerator = role === 'manager' || role === 'lead_generator' || role === 'admin' || role === 'superadmin'
  const canArchive = role === 'manager' || role === 'superadmin'
  const canDelete = role === 'superadmin'
  const canExport = isGenerator
  const canAllocate = role === 'owner' || role === 'superadmin' // §2: allocate batches → Owner only
  const { data: orgUsers } = useQuery({ queryKey: ['org-users-mini'], queryFn: () => usersApi.list(), enabled: canAllocate })
  const managers = (orgUsers ?? []).filter((u) => u.role === 'manager').map((u) => ({ id: u.id, name: u.name }))
  const allocate = useMutation({
    mutationFn: ({ id, mgr }: { id: string; mgr: string | null }) => assignmentApi.allocateBatch(id, mgr),
    onSuccess: () => { toast.success('Batch allocation updated'); qc.invalidateQueries({ queryKey: ['lead-batches'] }) },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['lead-batches'], queryFn: leadBatchesApi.list })
  const [searchRaw, setSearchRaw] = useState('')
  const search = useDebounce(searchRaw, 200).toLowerCase()
  const [showArchived, setShowArchived] = useState(false)
  const [deleteFor, setDeleteFor] = useState<LeadBatch | null>(null)

  const setArchived = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => leadBatchesApi.setArchived(id, archived),
    onSuccess: (_d, v) => { toast.success(v.archived ? 'Batch archived — leads and history preserved' : 'Batch restored'); qc.invalidateQueries({ queryKey: ['lead-batches'] }) },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  const removeBatch = useMutation({
    mutationFn: (id: string) => leadBatchesApi.remove(id),
    onSuccess: () => { toast.success('Batch permanently deleted'); setDeleteFor(null); qc.invalidateQueries({ queryKey: ['lead-batches'] }) },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  const exportBatch = useMutation({
    mutationFn: async (b: LeadBatch) => {
      const res = await manualLeadsApi.list({ batch_id: b.id })
      if (!res.data.length) throw new Error('This batch has no leads to export.')
      exportLeadsToXlsx(res.data, b.file_name)
      return res.data.length
    },
    onSuccess: (n) => toast.success(`Exported ${n} lead${n === 1 ? '' : 's'} to Excel`),
    onError: (e) => toast.error(normalizeError(e).message),
  })

  const all = data ?? []
  const archivedCount = all.filter((b) => b.archived_at).length
  const batches = useMemo(() => all.filter((b) => (showArchived ? !!b.archived_at : !b.archived_at)), [all, showArchived])
  const totals = useMemo(() => ({
    batches: batches.length,
    leads: batches.reduce((s, b) => s + b.lead_count, 0),
    booked: batches.reduce((s, b) => s + b.booked_count, 0),
  }), [batches])

  const filtered = useMemo(() => {
    if (!search) return batches
    return batches.filter((b) => (b.file_name + ' ' + b.template_name + ' ' + (b.created_by ?? '')).toLowerCase().includes(search))
  }, [batches, search])

  return (
    <div className="reveal">
      <PageHeader
        title="Leads"
        subtitle="Each uploaded sheet is a batch. Open one to work its leads."
        actions={isGenerator ? <Link to="/upload"><Button><FileUp className="h-4 w-4" /> Upload leads</Button></Link> : undefined}
      />

      {!isLoading && !isError && batches.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard label="Batches" value={totals.batches} />
          <StatCard label="Total leads" value={totals.leads} />
          <StatCard label="Booked" value={totals.booked} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1 sm:min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <Input value={searchRaw} onChange={(e) => setSearchRaw(e.target.value)} placeholder="Search batches…" className="pl-9" />
        </div>
        {canArchive && (archivedCount > 0 || showArchived) && (
          <button
            onClick={() => setShowArchived((v) => !v)}
            className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
              showArchived ? 'bg-[var(--color-primary)] text-[var(--color-primary-fg)]' : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]')}
          >
            <Archive className="h-3.5 w-3.5" /> Archived <span className="tabular-nums opacity-70">{archivedCount}</span>
          </button>
        )}
      </div>

      <Card>
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Layers}
            title={batches.length === 0 ? 'No batches yet' : 'No batches match'}
            message={batches.length === 0 ? 'Upload a sheet of leads — each upload becomes a batch you can work.' : 'Try a different search.'}
            action={isGenerator && batches.length === 0 ? <Link to="/upload"><Button><FileUp className="h-4 w-4" /> Upload leads</Button></Link> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th className="px-5 py-2.5 font-medium">Batch</th>
                  <th className="px-3 py-2.5 font-medium">Leads</th>
                  <th className="px-3 py-2.5 font-medium">Pipeline</th>
                  <th className="px-3 py-2.5 font-medium">Assigned</th>
                  <th className="px-3 py-2.5 font-medium">Uploaded</th>
                  {(canArchive || canDelete || canExport) && <th className="px-3 py-2.5" />}
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => (
                  <BatchRow
                    key={b.id} batch={b} onOpen={() => navigate(`/leads/batch/${b.id}`)}
                    canArchive={canArchive} canDelete={canDelete} canExport={canExport}
                    exporting={exportBatch.isPending && exportBatch.variables?.id === b.id}
                    onArchive={(archived) => setArchived.mutate({ id: b.id, archived })}
                    onDelete={() => setDeleteFor(b)}
                    onExport={() => exportBatch.mutate(b)}
                    allocateManagers={canAllocate ? managers : undefined}
                    onAllocate={(mgr) => allocate.mutate({ id: b.id, mgr })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={!!deleteFor}
        onOpenChange={(v) => { if (!v) setDeleteFor(null) }}
        title="Permanently delete this batch?"
        message={deleteFor ? `"${deleteFor.file_name}" and ALL ${deleteFor.lead_count} of its leads will be erased forever — including every note, activity record, Done credit and closer verdict. Setter performance history for these leads disappears from the Activity page. This cannot be undone. Consider Archive instead.` : ''}
        confirmLabel="Delete forever"
        requireText={deleteFor?.file_name}
        destructive
        loading={removeBatch.isPending}
        onConfirm={() => deleteFor && removeBatch.mutate(deleteFor.id)}
      />
    </div>
  )
}

function Pill({ label, value, className }: { label: string; value: number; className: string }) {
  if (!value) return null
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', className)}>{value} {label}</span>
}

function BatchRow({ batch: b, onOpen, canArchive, canDelete, canExport, exporting, onArchive, onDelete, onExport, allocateManagers, onAllocate }: {
  batch: LeadBatch; onOpen: () => void
  canArchive: boolean; canDelete: boolean; canExport: boolean; exporting: boolean
  onArchive: (archived: boolean) => void; onDelete: () => void; onExport: () => void
  allocateManagers?: { id: string; name: string }[]; onAllocate: (mgr: string | null) => void
}) {
  return (
    <tr className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]" onClick={onOpen}>
      <td className="px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"><FileSpreadsheet className="h-4 w-4" /></span>
          <div className="min-w-0">
            <p className="truncate font-medium text-[var(--color-text)]">{b.file_name}{b.archived_at && <span className="ml-2 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)]">Archived</span>}</p>
            <p className="truncate text-[12px] text-[var(--color-text-muted)]">{b.template_name}{b.created_by ? ` · by ${b.created_by}` : ''}</p>
          </div>
        </div>
      </td>
      <td className="px-3 py-3">
        <span className="font-semibold tabular-nums">{b.lead_count}</span>
        {b.rejected_count > 0 && <span className="ml-1 text-[12px] text-[var(--color-text-muted)]">({b.rejected_count} rejected)</span>}
        {b.lead_count > 0 && (
          <div className="mt-1 w-24">
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-border)]">
              <div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${b.lead_count ? Math.round((b.done_count / b.lead_count) * 100) : 0}%` }} />
            </div>
            <span className="text-[11px] text-[var(--color-text-muted)]">{b.done_count}/{b.lead_count} done</span>
          </div>
        )}
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-1">
          <Pill label="new" value={b.new_count} className="bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]" />
          <Pill label="contacted" value={b.contacted_count} className="bg-[var(--color-primary)]/10 text-[var(--color-primary)] dark:text-[var(--color-primary)]" />
          <Pill label="interested" value={b.interested_count} className="bg-violet-500/10 text-violet-700 dark:text-violet-400" />
          <Pill label="booked" value={b.booked_count} className="bg-amber-500/10 text-amber-700 dark:text-amber-400" />
          <Pill label="won" value={b.won_count} className="bg-green-500/10 text-green-700 dark:text-green-400" />
          <Pill label="lost" value={b.lost_count} className="bg-red-500/10 text-red-600 dark:text-red-400" />
          {b.lead_count === 0 && <span className="text-[12px] text-[var(--color-text-muted)]">—</span>}
        </div>
      </td>
      <td className="px-3 py-3">
        <span className="text-[13px] tabular-nums text-[var(--color-text-secondary)]">{b.assigned_count}</span>
        <span className="text-[12px] text-[var(--color-text-muted)]"> / {b.lead_count}</span>
        {allocateManagers && (
          <div className="mt-1" onClick={(e) => e.stopPropagation()}>
            <Select value={b.allocated_manager_id ?? ''} onValueChange={(v) => onAllocate(v || null)}
              aria-label="Allocate batch to a manager" className="h-7 text-[12px]"
              options={[{ value: '', label: 'Unallocated' }, ...allocateManagers.map((m) => ({ value: m.id, label: m.name }))]} />
          </div>
        )}
      </td>
      <td className="px-3 py-3 text-[13px] text-[var(--color-text-muted)]">{formatDistanceToNow(new Date(b.created_at), { addSuffix: true })}</td>
      {(canArchive || canDelete || canExport) && (
        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-1">
            {canExport && (
              <Button size="sm" variant="ghost" title="Export leads to Excel" disabled={b.lead_count === 0} loading={exporting} onClick={onExport}>
                <Download className="h-4 w-4" />
              </Button>
            )}
            {canArchive && (
              <Button size="sm" variant="ghost" title={b.archived_at ? 'Restore batch' : 'Archive batch (leads + history preserved)'} onClick={() => onArchive(!b.archived_at)}>
                {b.archived_at ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              </Button>
            )}
            {canDelete && (
              <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" title="Delete forever (superadmin)" onClick={onDelete}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </td>
      )}
    </tr>
  )
}
