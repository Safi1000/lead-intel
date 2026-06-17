import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, FileText, Send } from 'lucide-react'
import { toast } from 'sonner'
import { campaignsApi } from '../../api/endpoints'
import type { WaTemplate } from '../../api/types'
import { Button, Card, Input, Textarea, Badge } from '../../components/ui/primitives'
import { Dialog } from '../../components/ui/Dialog'
import { Tooltip } from '../../components/ui/controls'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'

const STATUS_META: Record<WaTemplate['status'], { label: string; className: string }> = {
  approved: { label: 'Approved', className: 'bg-green-50 text-green-700' },
  pending: { label: 'Pending', className: 'bg-amber-50 text-amber-700' },
  rejected: { label: 'Rejected', className: 'bg-red-50 text-red-700' },
}

function StatusBadge({ template }: { template: WaTemplate }) {
  const meta = STATUS_META[template.status]
  const badge = (
    <Badge className={meta.className}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {meta.label}
    </Badge>
  )
  if (template.status === 'rejected' && template.reject_reason) {
    return <Tooltip content={template.reject_reason}>{badge}</Tooltip>
  }
  return badge
}

function BodyPreview({ body }: { body: string }) {
  const parts = body.split(/(\{\{\d+\}\})/g)
  return (
    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
      {parts.map((p, i) =>
        /^\{\{\d+\}\}$/.test(p) ? (
          <span key={i} className="rounded bg-[var(--color-primary)]/10 px-1 font-mono text-[var(--color-primary)]">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  )
}

export function TemplatesPage() {
  const qc = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['campaign-templates'],
    queryFn: () => campaignsApi.templates(),
  })

  const submit = useMutation({
    mutationFn: (id: string) => campaignsApi.submitTemplate(id),
    onSuccess: () => {
      toast.success('Submitted to Meta for approval')
      qc.invalidateQueries({ queryKey: ['campaign-templates'] })
    },
    onError: () => toast.error('Couldn’t submit template'),
  })

  return (
    <div className="reveal">
      <PageHeader
        title="WhatsApp Templates"
        subtitle="Message templates must be approved by Meta before sending."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" /> New template
          </Button>
        }
      />

      {isLoading ? (
        <LoadingState label="Loading templates…" />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No templates yet"
          message="Create a template and submit it to Meta for approval."
          action={<Button onClick={() => setDialogOpen(true)}>New template</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((t) => (
            <Card key={t.id} className="p-5">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-[var(--color-text)]">{t.name}</h3>
                  <p className="mt-0.5 text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                    {t.category} · {t.language}
                  </p>
                </div>
                <StatusBadge template={t} />
              </div>

              <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
                <BodyPreview body={t.body} />
              </div>

              {t.status === 'rejected' && t.reject_reason && (
                <p className="mt-2 text-[12px] text-red-600">Rejected: {t.reject_reason}</p>
              )}

              {(t.status === 'pending' || t.status === 'rejected') && (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    loading={submit.isPending && submit.variables === t.id}
                    onClick={() => submit.mutate(t.id)}
                  >
                    <Send className="h-3.5 w-3.5" /> Submit for approval
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <NewTemplateDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  )
}

const CATEGORIES = ['Marketing', 'Utility'] as const
const LANGUAGES = [
  { code: 'en_US', label: 'English (US)' },
  { code: 'es_ES', label: 'Spanish' },
] as const

function NewTemplateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('Marketing')
  const [language, setLanguage] = useState<(typeof LANGUAGES)[number]['code']>('en_US')
  const [body, setBody] = useState('')

  const create = useMutation({
    mutationFn: () => campaignsApi.createTemplate({ name: name.trim(), category, body: body.trim() }),
    onSuccess: () => {
      toast.success('Template created — pending approval')
      qc.invalidateQueries({ queryKey: ['campaign-templates'] })
      reset()
      onOpenChange(false)
    },
    onError: () => toast.error('Couldn’t create template'),
  })

  function reset() {
    setName('')
    setCategory('Marketing')
    setLanguage('en_US')
    setBody('')
  }

  const canCreate = name.trim().length > 0 && body.trim().length > 0 && !create.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
      title="New template"
      description="New templates are submitted to Meta as pending and can be sent once approved."
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--color-text)]">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="june_followup" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text)]">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}
              className="h-9 w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text)]">Language</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as (typeof LANGUAGES)[number]['code'])}
              className="h-9 w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--color-text)]">Body</label>
          <Textarea
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Hi {{1}}, this is {{2}} from Acme Roofing…"
          />
          <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
            Use <span className="font-mono">{'{{1}}'}</span>, <span className="font-mono">{'{{2}}'}</span> for
            variables filled per recipient.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canCreate} loading={create.isPending} onClick={() => create.mutate()}>
            Create template
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
