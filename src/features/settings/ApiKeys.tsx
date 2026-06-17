import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { AlertTriangle, BookOpen, Check, ChevronDown, Copy, KeyRound, Plus, Trash2 } from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { apiKeysApi } from '../../api/endpoints'
import { Button, Card, Input, Label, Badge } from '../../components/ui/primitives'
import { Dialog, ConfirmDialog } from '../../components/ui/Dialog'
import { Checkbox } from '../../components/ui/controls'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { Can } from '../../components/rbac/Can'
import { formatNumber, cn } from '../../lib/utils'
import { relativeTime, shortDate } from '../../lib/time'
import type { ApiKey, ApiKeyUsage } from '../../api/types'

const SCOPE_OPTIONS = ['runs:read', 'leads:read', 'exports:write', 'webhooks:manage']

export function ApiKeysSettingsPage() {
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['api-keys'],
    queryFn: apiKeysApi.list,
  })
  const [creating, setCreating] = useState(false)

  if (isLoading) return <LoadingState label="Loading API keys…" />
  if (isError) return <ErrorState message="We couldn’t load your API keys." onRetry={() => refetch()} />

  return (
    <div className="reveal space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-text-secondary)]">Programmatic access to the LeadIntel REST API.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate('/settings/api-keys/docs')}>
            <BookOpen className="h-3.5 w-3.5" /> View API docs
          </Button>
          <Can action="manage" resource="apiKeys">
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" /> Create key
            </Button>
          </Can>
        </div>
      </div>

      {!data || data.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No API keys"
          message="Create a key to authenticate API requests. Keep secrets safe — they’re shown only once."
          action={
            <Can action="manage" resource="apiKeys">
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-3.5 w-3.5" /> Create key
              </Button>
            </Can>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-[1.4fr_1.4fr_1.4fr_0.8fr_1fr_1fr_auto] gap-3 border-b border-[var(--color-border)] px-5 py-3 text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            <span>Name</span>
            <span>Key</span>
            <span>Scopes</span>
            <span>Rate limit</span>
            <span>Created</span>
            <span>Last used</span>
            <span />
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {data.map((k) => (
              <ApiKeyRow key={k.id} apiKey={k} />
            ))}
          </div>
        </Card>
      )}

      {creating && <CreateKeyDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

function ApiKeyRow({ apiKey }: { apiKey: ApiKey }) {
  const qc = useQueryClient()
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [showUsage, setShowUsage] = useState(false)

  const revoke = useMutation({
    mutationFn: () => apiKeysApi.revoke(apiKey.id),
    onSuccess: () => {
      toast.success('Key revoked')
      qc.invalidateQueries({ queryKey: ['api-keys'] })
      setConfirmRevoke(false)
    },
  })

  return (
    <div>
      <div className="grid grid-cols-[1.4fr_1.4fr_1.4fr_0.8fr_1fr_1fr_auto] items-center gap-3 px-5 py-3.5">
        <span className="text-sm font-medium text-[var(--color-text)]">{apiKey.name}</span>
        <span className="font-data text-[13px] text-[var(--color-text-secondary)]">{apiKey.masked}</span>
        <span className="flex flex-wrap gap-1">
          {apiKey.scopes.map((s) => (
            <Badge key={s} className="bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">{s}</Badge>
          ))}
        </span>
        <span className="text-[13px] tabular-nums text-[var(--color-text-secondary)]">{formatNumber(apiKey.rate_limit)}/h</span>
        <span className="text-[13px] text-[var(--color-text-secondary)]">{shortDate(apiKey.created_at)}</span>
        <span className="text-[13px] text-[var(--color-text-secondary)]">{relativeTime(apiKey.last_used)}</span>
        <span className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setShowUsage((s) => !s)}>
            Usage <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showUsage && 'rotate-180')} />
          </Button>
          <Can action="manage" resource="apiKeys">
            <Button size="sm" variant="ghost" className="text-[var(--c-unverified)]" onClick={() => setConfirmRevoke(true)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </Can>
        </span>
      </div>

      {showUsage && <UsagePanel keyId={apiKey.id} />}

      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title="Revoke API key?"
        message="Any integration using this key will stop working immediately. This cannot be undone."
        confirmLabel="Revoke key"
        requireText={apiKey.name}
        destructive
        loading={revoke.isPending}
        onConfirm={() => revoke.mutate()}
      />
    </div>
  )
}

function UsagePanel({ keyId }: { keyId: string }) {
  const { data, isLoading, isError, refetch } = useQuery<ApiKeyUsage>({
    queryKey: ['api-key-usage', keyId],
    queryFn: () => apiKeysApi.usage(keyId),
  })

  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-4">
      {isLoading ? (
        <LoadingState label="Loading usage…" />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !data || data.series.length === 0 ? (
        <EmptyState title="No usage yet" message="This key hasn’t made any requests." />
      ) : (
        <>
          <div className="mb-3 flex gap-6 text-[13px]">
            <span className="text-[var(--color-text-secondary)]">Total calls: <strong className="tabular-nums text-[var(--color-text)]">{formatNumber(data.total_calls)}</strong></span>
            <span className="text-[var(--color-text-secondary)]">429s: <strong className="tabular-nums text-[var(--c-unverified-text)]">{formatNumber(data.total_429)}</strong></span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={data.series} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#94A3B8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94A3B8" />
              <RTooltip />
              <Line type="monotone" dataKey="calls" stroke="var(--color-primary)" strokeWidth={2} dot={false} name="Calls" />
              <Line type="monotone" dataKey="errors" stroke="var(--c-unverified)" strokeWidth={2} dot={false} name="Errors" />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  )
}

function CreateKeyDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>([])
  const [rateLimit, setRateLimit] = useState(1000)
  const [secret, setSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const create = useMutation({
    mutationFn: () => apiKeysApi.create({ name, scopes, rate_limit: rateLimit }),
    onSuccess: (r) => {
      setSecret(r.secret)
      qc.invalidateQueries({ queryKey: ['api-keys'] })
      toast.success('API key created')
    },
    onError: () => toast.error('Couldn’t create key'),
  })

  function toggle(s: string) {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }

  function copySecret() {
    if (secret) navigator.clipboard?.writeText(secret)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const valid = name.trim().length > 0 && scopes.length > 0 && rateLimit > 0

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Create API key" description="Scope the key to the minimum access it needs.">
      {secret ? (
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-[8px] border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>This secret is shown only once. Store it safely — you won’t be able to see it again.</span>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
            <code className="font-data truncate text-[13px] text-[var(--color-text)]">{secret}</code>
            <Button size="sm" variant="ghost" onClick={copySecret}>
              {copied ? <Check className="h-3.5 w-3.5 text-[var(--c-verified)]" /> : <Copy className="h-3.5 w-3.5" />} Copy
            </Button>
          </div>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            <div>
              <Label htmlFor="key-name">Name</Label>
              <Input id="key-name" value={name} placeholder="Production server" onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>Scopes</Label>
              <div className="space-y-2">
                {SCOPE_OPTIONS.map((s) => (
                  <label key={s} className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text)]">
                    <Checkbox checked={scopes.includes(s)} onCheckedChange={() => toggle(s)} aria-label={s} />
                    <span className="font-data">{s}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="key-rate">Rate limit (requests / hour)</Label>
              <Input
                id="key-rate"
                type="number"
                min={1}
                value={rateLimit}
                onChange={(e) => setRateLimit(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={!valid} loading={create.isPending} onClick={() => create.mutate()}>Create key</Button>
          </div>
        </>
      )}
    </Dialog>
  )
}
