import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { FileSpreadsheet, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { templatesApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { useCan } from '../../components/rbac/Can'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { Dialog, ConfirmDialog } from '../../components/ui/Dialog'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import { cn } from '../../lib/utils'
import type { LeadTemplate } from '../../api/types'

interface DraftColumn {
  name: string
  required: boolean
}

export function TemplatesPage() {
  const qc = useQueryClient()
  const canManage = useCan('create', 'templates')
  const canView = useCan('view', 'templates')
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['templates'], queryFn: templatesApi.list, enabled: canView })
  const [editing, setEditing] = useState<LeadTemplate | 'new' | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LeadTemplate | null>(null)

  const remove = useMutation({
    mutationFn: (id: string) => templatesApi.remove(id),
    onSuccess: () => {
      toast.success('Template deleted')
      setDeleteTarget(null)
      qc.invalidateQueries({ queryKey: ['templates'] })
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  if (!canView) {
    return <EmptyState icon={FileSpreadsheet} title="No access" message="Templates are managed by lead generators and managers." />
  }

  const templates = data ?? []

  return (
    <div className="reveal">
      <PageHeader
        title="Upload templates"
        subtitle="Define the exact columns an Excel sheet must provide. Header matching is case-sensitive."
        actions={
          canManage && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" /> New template
            </Button>
          )
        }
      />

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : templates.length === 0 ? (
        <EmptyState
          icon={FileSpreadsheet}
          title="No templates yet"
          message="Create a template that mirrors your spreadsheet's columns, then upload leads against it."
          action={canManage && <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> New template</Button>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <Card key={t.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-[15px] font-semibold">{t.name}</h3>
                  <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">
                    {t.columns.length} column{t.columns.length === 1 ? '' : 's'} · {t.lead_count} lead{t.lead_count === 1 ? '' : 's'} imported
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {t.columns.map((c) => (
                  <span
                    key={c.id}
                    className={cn(
                      'rounded-full px-2 py-0.5 font-mono text-[11px]',
                      c.required ? 'bg-blue-50 text-[var(--color-primary)]' : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]',
                    )}
                    title={c.required ? 'Required' : 'Optional'}
                  >
                    {c.name}
                    {c.required && <span aria-hidden> *</span>}
                  </span>
                ))}
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-[var(--color-border)] pt-3">
                <Link to={`/upload?template=${t.id}`} className="flex-1">
                  <Button size="sm" variant="outline" className="w-full">
                    <Upload className="h-3.5 w-3.5" /> Upload
                  </Button>
                </Link>
                {canManage && (
                  <>
                    <Button size="icon" variant="ghost" aria-label="Edit template" onClick={() => setEditing(t)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label="Delete template" onClick={() => setDeleteTarget(t)}>
                      <Trash2 className="h-4 w-4 text-[var(--c-unverified)]" />
                    </Button>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <TemplateBuilder
          template={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            qc.invalidateQueries({ queryKey: ['templates'] })
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.name}"?`}
        message="The template is removed. Leads already imported with it are kept."
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
      />
    </div>
  )
}

/** Create/edit dialog. Manages the column list (name + required). */
function TemplateBuilder({ template, onClose, onSaved }: { template: LeadTemplate | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(template?.name ?? '')
  const [columns, setColumns] = useState<DraftColumn[]>(
    template?.columns.map((c) => ({ name: c.name, required: c.required })) ?? [{ name: '', required: true }],
  )

  const save = useMutation({
    mutationFn: () => {
      const payload = { name: name.trim(), columns: columns.map((c) => ({ name: c.name.trim(), required: c.required })).filter((c) => c.name) }
      return template ? templatesApi.update(template.id, payload) : templatesApi.create(payload)
    },
    onSuccess: () => {
      toast.success(template ? 'Template updated' : 'Template created')
      onSaved()
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  const named = columns.map((c) => c.name.trim()).filter(Boolean)
  const hasDuplicates = new Set(named).size !== named.length // case-sensitive
  const valid = name.trim().length > 0 && named.length > 0 && !hasDuplicates

  const setCol = (i: number, patch: Partial<DraftColumn>) =>
    setColumns((cols) => cols.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={template ? 'Edit template' : 'New template'}
      description="Column names must exactly match the spreadsheet headers — capitalisation and spacing included."
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="tpl-name">Template name</Label>
          <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Roofing Leads — Texas" />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <Label className="mb-0">Columns</Label>
            <span className="text-[12px] text-[var(--color-text-muted)]">Required columns must be present &amp; non-empty</span>
          </div>
          <div className="space-y-2">
            {columns.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={c.name}
                  onChange={(e) => setCol(i, { name: e.target.value })}
                  placeholder="Exact header, e.g. Email"
                  className="font-mono"
                />
                <label className="flex shrink-0 items-center gap-1.5 text-[13px] text-[var(--color-text-secondary)]">
                  <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={c.required} onChange={(e) => setCol(i, { required: e.target.checked })} />
                  Required
                </label>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove column"
                  disabled={columns.length === 1}
                  onClick={() => setColumns((cols) => cols.filter((_, idx) => idx !== i))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          {hasDuplicates && <p className="mt-1.5 text-[13px] text-[var(--c-unverified)]">Column names must be unique (case-sensitive).</p>}
          <Button variant="outline" size="sm" className="mt-2" onClick={() => setColumns((cols) => [...cols, { name: '', required: false }])}>
            <Plus className="h-3.5 w-3.5" /> Add column
          </Button>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] pt-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            {template ? 'Save changes' : 'Create template'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
