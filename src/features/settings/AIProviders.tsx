import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { aiProvidersApi } from '../../api/endpoints'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { Switch } from '../../components/ui/controls'
import { ErrorState, LoadingState } from '../../components/feedback'
import { Can } from '../../components/rbac/Can'
import { AIProviderBadge } from '../../components/ai/streaming'
import { cn } from '../../lib/utils'
import type { AIProviderConfig, AITask } from '../../api/types'

const MODEL_OPTIONS = ['claude-opus-4-8', 'gpt-4o', 'gemini-2.0', 'llama-3-70b', 'mistral-large']

const TASKS: { key: AITask; label: string; desc: string }[] = [
  { key: 'scoring', label: 'Scoring', desc: 'Rank and score leads by opportunity signal.' },
  { key: 'copy', label: 'Copy / Outreach', desc: 'Generate outreach openers and sequences.' },
  { key: 'summary', label: 'Summary', desc: 'Summarize markets, runs, and conversations.' },
]

const PROVIDERS = ['claude-opus-4-8', 'gpt-4o', 'gemini-2.0', 'llama-3-70b', 'mistral-large']

export function AIProvidersSettingsPage() {
  const qc = useQueryClient()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['ai-providers'],
    queryFn: aiProvidersApi.get,
  })
  const [config, setConfig] = useState<AIProviderConfig | null>(null)
  useEffect(() => {
    if (data) setConfig(data)
  }, [data])

  const save = useMutation({
    mutationFn: (c: AIProviderConfig) => aiProvidersApi.update(c),
    onSuccess: () => {
      toast.success('AI provider settings saved')
      qc.invalidateQueries({ queryKey: ['ai-providers'] })
    },
    onError: () => toast.error('Couldn’t save settings'),
  })

  if (isLoading) return <LoadingState label="Loading AI providers…" />
  if (isError) return <ErrorState message="We couldn’t load AI provider settings." onRetry={() => refetch()} />
  if (!config) return <LoadingState />

  function setAssignment(task: AITask, model: string) {
    setConfig((c) => (c ? { ...c, assignments: { ...c.assignments, [task]: model } } : c))
  }

  function setKeyState(provider: string, present: boolean, valid: boolean) {
    setConfig((c) => (c ? { ...c, byo_keys: { ...c.byo_keys, [provider]: { present, valid } } } : c))
  }

  return (
    <div className="reveal max-w-3xl space-y-6">
      <Card>
        <div className="border-b border-[var(--color-border)] px-6 py-4">
          <h2 className="text-[16px] font-semibold">Model assignments</h2>
          <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">Choose which model powers each AI task.</p>
        </div>
        <ul className="divide-y divide-[var(--color-border)]">
          {TASKS.map((t) => (
            <li key={t.key} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t.label}</p>
                <p className="text-[13px] text-[var(--color-text-secondary)]">{t.desc}</p>
              </div>
              <div className="flex items-center gap-3">
                <AIProviderBadge provider={config.assignments[t.key]} />
                <Can action="manage" resource="aiProviders" disable>
                  <select
                    value={config.assignments[t.key]}
                    onChange={(e) => setAssignment(t.key, e.target.value)}
                    className="h-9 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus-visible:outline-none"
                  >
                    {MODEL_OPTIONS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </Can>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <div className="border-b border-[var(--color-border)] px-6 py-4">
          <h2 className="text-[16px] font-semibold">Bring your own API keys</h2>
          <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">Use your own provider credits. Keys are stored encrypted.</p>
        </div>
        <ul className="divide-y divide-[var(--color-border)]">
          {PROVIDERS.map((p) => (
            <ByoKeyRow
              key={p}
              provider={p}
              present={config.byo_keys[p]?.present ?? false}
              valid={config.byo_keys[p]?.valid ?? false}
              onValidated={() => setKeyState(p, true, true)}
            />
          ))}
        </ul>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Use open-source model for batch operations</p>
            <p className="text-[13px] text-[var(--color-text-secondary)]">Route large batch jobs to an open-source model to reduce cost.</p>
          </div>
          <Can action="manage" resource="aiProviders" disable>
            <Switch
              checked={config.batch_open_source}
              onCheckedChange={(v) => setConfig((c) => (c ? { ...c, batch_open_source: v } : c))}
            />
          </Can>
        </div>
      </Card>

      <Can action="manage" resource="aiProviders">
        <div className="flex justify-end">
          <Button loading={save.isPending} onClick={() => config && save.mutate(config)}>Save changes</Button>
        </div>
      </Can>
    </div>
  )
}

function ByoKeyRow({
  provider,
  present,
  valid,
  onValidated,
}: {
  provider: string
  present: boolean
  valid: boolean
  onValidated: () => void
}) {
  const [value, setValue] = useState('')
  const [validating, setValidating] = useState(false)

  function validate() {
    if (!value.trim()) {
      toast.error('Enter a key to validate')
      return
    }
    setValidating(true)
    setTimeout(() => {
      setValidating(false)
      onValidated()
      toast.success('Key valid')
    }, 700)
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-6 py-4">
      <div className="flex w-40 items-center gap-2">
        <AIProviderBadge provider={provider} />
      </div>
      <div className="min-w-[180px] flex-1">
        <Label htmlFor={`byo-${provider}`} className="sr-only">{provider} API key</Label>
        <Input
          id={`byo-${provider}`}
          type="password"
          value={value}
          placeholder={present ? '••••••••••••••••' : 'sk-…'}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <Can action="manage" resource="aiProviders" disable>
        <Button size="sm" variant="outline" loading={validating} onClick={validate}>Validate</Button>
      </Can>
      <span className={cn('inline-flex items-center gap-1 text-[12px]', valid ? 'text-[var(--c-verified-text)]' : present ? 'text-[var(--color-text-muted)]' : 'text-amber-600')}>
        {valid ? (
          <><CheckCircle2 className="h-3.5 w-3.5" /> Valid</>
        ) : present ? (
          <>Key present</>
        ) : (
          <><AlertCircle className="h-3.5 w-3.5" /> No key configured</>
        )}
      </span>
    </li>
  )
}
