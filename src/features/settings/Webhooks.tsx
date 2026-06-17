import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Copy, Eye, EyeOff, Plus, RefreshCw, Send, Trash2, Webhook as WebhookIcon } from 'lucide-react'
import { webhooksApi } from '../../api/endpoints'
import { Button, Card, Input, Label, Badge } from '../../components/ui/primitives'
import { Dialog, ConfirmDialog } from '../../components/ui/Dialog'
import { Switch, Checkbox } from '../../components/ui/controls'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { Can } from '../../components/rbac/Can'
import { relativeTime } from '../../lib/time'
import { cn } from '../../lib/utils'
import type { Webhook, WebhookDelivery } from '../../api/types'

const EVENT_OPTIONS = ['batch.completed', 'lead.enriched', 'run.failed', 'run.completed']

function statusTone(status: number): string {
  if (status >= 200 && status < 300) return 'bg-[var(--c-verified-bg)] text-[var(--c-verified-text)]'
  if (status >= 400) return 'bg-[var(--c-unverified-bg)] text-[var(--c-unverified-text)]'
  return 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]'
}

export function WebhooksSettingsPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['webhooks'],
    queryFn: webhooksApi.list,
  })
  const [adding, setAdding] = useState(false)

  if (isLoading) return <LoadingState label="Loading webhooks…" />
  if (isError) return <ErrorState message="We couldn’t load your webhooks." onRetry={() => refetch()} />

  return (
    <div className="reveal space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-text-secondary)]">
          Receive HTTP callbacks when events happen in LeadIntel.
        </p>
        <Can action="manage" resource="webhooks">
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> Add endpoint
          </Button>
        </Can>
      </div>

      {!data || data.length === 0 ? (
        <EmptyState
          icon={WebhookIcon}
          title="No webhook endpoints"
          message="Add an endpoint to receive real-time events. See the webhook docs for payload formats and signature verification."
          action={
            <Can action="manage" resource="webhooks">
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-3.5 w-3.5" /> Add endpoint
              </Button>
            </Can>
          }
        />
      ) : (
        <div className="space-y-3">
          {data.map((w) => (
            <WebhookRow key={w.id} webhook={w} />
          ))}
        </div>
      )}

      {adding && <AddEndpointDialog onClose={() => setAdding(false)} />}
    </div>
  )
}

function WebhookRow({ webhook }: { webhook: Webhook }) {
  const qc = useQueryClient()
  const [showSecret, setShowSecret] = useState(false)
  const [copied, setCopied] = useState(false)
  const [testResult, setTestResult] = useState<{ status: number; body: string } | null>(null)
  const [showDeliveries, setShowDeliveries] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const update = useMutation({
    mutationFn: (partial: Partial<Webhook>) => webhooksApi.update(webhook.id, partial),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
    onError: () => toast.error('Couldn’t update endpoint'),
  })

  const test = useMutation({
    mutationFn: () => webhooksApi.test(webhook.id),
    onSuccess: (r) => {
      setTestResult(r)
      toast.success(`Test sent — responded ${r.status}`)
    },
    onError: () => toast.error('Test delivery failed'),
  })

  const rotate = useMutation({
    mutationFn: () => webhooksApi.update(webhook.id, { secret: `whsec_${Math.random().toString(36).slice(2, 18)}` }),
    onSuccess: () => {
      toast.success('Signing secret rotated')
      qc.invalidateQueries({ queryKey: ['webhooks'] })
    },
  })

  const remove = useMutation({
    mutationFn: () => webhooksApi.remove(webhook.id),
    onSuccess: () => {
      toast.success('Endpoint deleted')
      qc.invalidateQueries({ queryKey: ['webhooks'] })
      setConfirmDelete(false)
    },
  })

  function copySecret() {
    navigator.clipboard?.writeText(webhook.secret)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-data text-sm font-medium text-[var(--color-text)] break-all">{webhook.url}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {webhook.events.map((e) => (
              <Badge key={e} className="bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">{e}</Badge>
            ))}
          </div>
          {webhook.last_delivery ? (
            <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">
              Last delivery{' '}
              <span className={cn('rounded px-1.5 py-0.5 font-data text-[11px]', statusTone(webhook.last_delivery.status))}>
                {webhook.last_delivery.status}
              </span>{' '}
              {relativeTime(webhook.last_delivery.at)}
            </p>
          ) : (
            <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">No deliveries yet</p>
          )}
        </div>
        <Can action="manage" resource="webhooks">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[var(--color-text-muted)]">{webhook.enabled ? 'Enabled' : 'Disabled'}</span>
            <Switch checked={webhook.enabled} onCheckedChange={(v) => update.mutate({ enabled: v })} />
          </div>
        </Can>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-4">
        <Button size="sm" variant="outline" loading={test.isPending} onClick={() => test.mutate()}>
          <Send className="h-3.5 w-3.5" /> Test
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowDeliveries(true)}>
          Deliveries
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowSecret((s) => !s)}>
          {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {showSecret ? 'Hide' : 'Reveal'} secret
        </Button>
        <Can action="manage" resource="webhooks">
          <Button size="sm" variant="ghost" className="ml-auto text-[var(--c-unverified)]" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </Can>
      </div>

      {showSecret && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
          <code className="font-data truncate text-[13px] text-[var(--color-text)]">{webhook.secret}</code>
          <div className="flex shrink-0 gap-1">
            <Button size="sm" variant="ghost" onClick={copySecret}>
              {copied ? <Check className="h-3.5 w-3.5 text-[var(--c-verified)]" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
            <Can action="manage" resource="webhooks">
              <Button size="sm" variant="ghost" loading={rotate.isPending} onClick={() => rotate.mutate()}>
                <RefreshCw className="h-3.5 w-3.5" /> Rotate
              </Button>
            </Can>
          </div>
        </div>
      )}

      {testResult && (
        <div className="mt-3 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
          <div className="mb-1 flex items-center gap-2">
            <span className={cn('rounded px-1.5 py-0.5 font-data text-[11px] font-medium', statusTone(testResult.status))}>{testResult.status}</span>
            <span className="text-[12px] text-[var(--color-text-muted)]">Response</span>
          </div>
          <pre className="font-data max-h-40 overflow-auto whitespace-pre-wrap text-[12px] text-[var(--color-text-secondary)]">{testResult.body}</pre>
        </div>
      )}

      {showDeliveries && <DeliveriesDialog webhookId={webhook.id} onClose={() => setShowDeliveries(false)} />}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete webhook endpoint?"
        message="This endpoint will stop receiving events immediately. This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </Card>
  )
}

function DeliveriesDialog({ webhookId, onClose }: { webhookId: string; onClose: () => void }) {
  const { data, isLoading, isError, refetch } = useQuery<WebhookDelivery[]>({
    queryKey: ['webhook-deliveries', webhookId],
    queryFn: () => webhooksApi.deliveries(webhookId),
  })

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Recent deliveries" description="The last events sent to this endpoint.">
      {isLoading ? (
        <LoadingState label="Loading deliveries…" />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="No deliveries" message="No events have been delivered to this endpoint yet." />
      ) : (
        <ul className="max-h-80 divide-y divide-[var(--color-border)] overflow-auto">
          {data.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="font-data text-[13px] text-[var(--color-text)]">{d.event}</p>
                <p className="text-[12px] text-[var(--color-text-muted)]">{relativeTime(d.at)} · {d.duration_ms}ms</p>
              </div>
              <span className={cn('rounded px-2 py-0.5 font-data text-[12px] font-medium', statusTone(d.status))}>{d.status}</span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}

function AddEndpointDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>([])

  const create = useMutation({
    mutationFn: () => webhooksApi.create({ url, events }),
    onSuccess: () => {
      toast.success('Endpoint added')
      qc.invalidateQueries({ queryKey: ['webhooks'] })
      onClose()
    },
    onError: () => toast.error('Couldn’t add endpoint'),
  })

  function toggle(e: string) {
    setEvents((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]))
  }

  const valid = /^https?:\/\//.test(url) && events.length > 0

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Add webhook endpoint" description="Send events to your server.">
      <div className="space-y-4">
        <div>
          <Label htmlFor="wh-url">Endpoint URL</Label>
          <Input id="wh-url" value={url} placeholder="https://example.com/hooks/leadintel" onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div>
          <Label>Events</Label>
          <div className="space-y-2">
            {EVENT_OPTIONS.map((e) => (
              <label key={e} className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text)]">
                <Checkbox checked={events.includes(e)} onCheckedChange={() => toggle(e)} aria-label={e} />
                <span className="font-data">{e}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!valid} loading={create.isPending} onClick={() => create.mutate()}>Add endpoint</Button>
      </div>
    </Dialog>
  )
}
