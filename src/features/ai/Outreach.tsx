import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Mail,
  MessageCircle,
  Smartphone,
  Plus,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Trash2,
  Pencil,
  Users,
  Save,
} from 'lucide-react'
import { runsApi, leadsApi, aiApi } from '../../api/endpoints'
import type { LeadRow } from '../../api/types'
import { Button, Card, Textarea, Badge } from '../../components/ui/primitives'
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/controls'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader, SectionCard } from '../shared/bits'
import {
  StreamingText,
  useStream,
  GenerationControls,
  VariantTabs,
} from '../../components/ai/streaming'
import { ConfidenceDot } from '../../components/confidence'
import { cn } from '../../lib/utils'

const CHANNELS = [
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { id: 'sms', label: 'SMS', icon: Smartphone },
] as const

const TONES = ['direct', 'consultative', 'curiosity']

interface SeqStep {
  uid: string
  channel: string
  delay: string
  text: string
}

let _seq = 0

function LeadPicker({
  selected,
  onSelect,
}: {
  selected: LeadRow | null
  onSelect: (lead: LeadRow) => void
}) {
  const [runId, setRunId] = React.useState<string | null>(null)

  const runs = useQuery({
    queryKey: ['outreach-runs'],
    queryFn: () => runsApi.list({ page_size: 20 }),
  })

  const leads = useQuery({
    queryKey: ['outreach-leads', runId],
    queryFn: () => leadsApi.listForRun(runId as string, { page_size: 20 }),
    enabled: !!runId,
  })

  React.useEffect(() => {
    if (!runId && runs.data?.data.length) setRunId(runs.data.data[0].id)
  }, [runs.data, runId])

  return (
    <SectionCard title="Pick a lead" className="reveal">
      <div className="space-y-3 p-5">
        {runs.isLoading ? (
          <LoadingState label="Loading runs…" />
        ) : runs.isError ? (
          <ErrorState message="Couldn’t load runs." onRetry={() => runs.refetch()} />
        ) : !runs.data?.data.length ? (
          <EmptyState title="No runs yet" message="Launch a run to generate leads first." />
        ) : (
          <>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                Run
              </span>
              <select
                value={runId ?? ''}
                onChange={(e) => setRunId(e.target.value)}
                className="h-9 w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus-visible:outline-none"
              >
                {runs.data.data.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.trade} — {r.location_label}
                  </option>
                ))}
              </select>
            </label>

            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {leads.isLoading ? (
                <LoadingState label="Loading leads…" />
              ) : leads.isError ? (
                <ErrorState message="Couldn’t load leads." onRetry={() => leads.refetch()} />
              ) : !leads.data?.data.length ? (
                <EmptyState title="No leads" message="This run has no leads." />
              ) : (
                leads.data.data.map((lead) => (
                  <button
                    key={lead.id}
                    onClick={() => onSelect(lead)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-[8px] border px-3 py-2 text-left text-sm transition-colors',
                      selected?.id === lead.id
                        ? 'border-[var(--color-primary)] bg-[var(--color-surface-2)]'
                        : 'border-[var(--color-border)] hover:bg-[var(--color-surface-2)]',
                    )}
                  >
                    <span className="inline-flex items-center gap-1.5 truncate text-[var(--color-text)]">
                      <ConfidenceDot status={lead.row_confidence} />
                      <span className="truncate">{lead.business_name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-[var(--color-text-muted)]">
                      {lead.score ?? '—'}
                    </span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </SectionCard>
  )
}

function MessageComposer({ lead }: { lead: LeadRow }) {
  const [channel, setChannel] = React.useState<string>('email')
  const [tone, setTone] = React.useState<string>('direct')
  const [editing, setEditing] = React.useState(false)
  const [edited, setEdited] = React.useState('')
  const [nonce, setNonce] = React.useState(0)

  const gen = useQuery({
    queryKey: ['outreach', lead.id, channel, tone, nonce],
    queryFn: () => aiApi.outreach(lead.id, channel, tone),
  })

  const text = gen.data?.text ?? ''
  const { shown, streaming, stop } = useStream(gen.data ? text : null, [lead.id, channel, tone, nonce])

  React.useEffect(() => {
    setEditing(false)
    setEdited(text)
  }, [text])

  return (
    <SectionCard
      title="Outreach message"
      className="reveal"
      action={gen.data && <AIProviderBadgeInline provider={gen.data.provider} />}
    >
      <div className="space-y-4 p-5">
        <Tabs value={channel} onValueChange={setChannel}>
          <TabsList>
            {CHANNELS.map((c) => (
              <TabsTrigger key={c.id} value={c.id}>
                <span className="inline-flex items-center gap-1.5">
                  <c.icon className="h-4 w-4" /> {c.label}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <VariantTabs variants={TONES} active={tone} onChange={setTone} />

        <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
          {gen.isLoading ? (
            <LoadingState label="Generating…" className="py-8" />
          ) : gen.isError ? (
            <ErrorState message="Couldn’t generate copy." onRetry={() => gen.refetch()} />
          ) : editing ? (
            <Textarea
              value={edited}
              onChange={(e) => setEdited(e.target.value)}
              rows={8}
              aria-label="Edit message"
            />
          ) : (
            <StreamingText text={streaming ? shown : edited || text} streaming={streaming} onStop={stop} />
          )}
        </div>

        {!gen.isLoading && !gen.isError && (
          <GenerationControls
            onRegenerate={() => setNonce((n) => n + 1)}
            copyValue={editing ? edited : text}
            extra={
              <Button size="sm" variant="outline" onClick={() => setEditing((e) => !e)}>
                <Pencil className="h-3.5 w-3.5" /> {editing ? 'Preview' : 'Edit'}
              </Button>
            }
          />
        )}
      </div>
    </SectionCard>
  )
}

function AIProviderBadgeInline({ provider }: { provider: string }) {
  return (
    <span className="text-[11px] text-[var(--color-text-muted)]">via {provider}</span>
  )
}

function SequenceBuilder({ lead }: { lead: LeadRow }) {
  const [steps, setSteps] = React.useState<SeqStep[] | null>(null)

  const mutation = useMutation({
    mutationFn: () => aiApi.sequence(lead.id),
    onSuccess: (res) =>
      setSteps(res.steps.map((s) => ({ uid: `s${++_seq}`, ...s }))),
    onError: () => toast.error('Couldn’t build a sequence.'),
  })

  React.useEffect(() => {
    setSteps(null)
  }, [lead.id])

  const move = (i: number, dir: -1 | 1) => {
    setSteps((prev) => {
      if (!prev) return prev
      const j = i + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  const remove = (uid: string) =>
    setSteps((prev) => (prev ? prev.filter((s) => s.uid !== uid) : prev))

  const update = (uid: string, value: string) =>
    setSteps((prev) => (prev ? prev.map((s) => (s.uid === uid ? { ...s, text: value } : s)) : prev))

  return (
    <SectionCard
      title="Follow-up sequence"
      className="reveal"
      action={
        <Button
          size="sm"
          variant="outline"
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          <Plus className="h-3.5 w-3.5" /> Generate 3-step sequence
        </Button>
      }
    >
      <div className="p-5">
        {!steps ? (
          <EmptyState
            icon={Plus}
            title="No sequence yet"
            message="Generate a 3-step follow-up sequence tailored to this lead."
          />
        ) : steps.length === 0 ? (
          <EmptyState title="Sequence empty" message="All steps removed. Generate a new sequence." />
        ) : (
          <div className="space-y-3">
            {steps.map((step, i) => (
              <Card key={step.uid} className="reveal bg-[var(--color-surface-2)] p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 text-[var(--color-text-muted)]" />
                    <Badge className="bg-[var(--color-surface)] text-[var(--color-text-secondary)]">
                      {step.channel}
                    </Badge>
                    <span className="text-[12px] text-[var(--color-text-muted)]">{step.delay}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Move up"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Move down"
                      disabled={i === steps.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Remove step"
                      onClick={() => remove(step.uid)}
                    >
                      <Trash2 className="h-4 w-4 text-[var(--c-unverified)]" />
                    </Button>
                  </div>
                </div>
                <Textarea
                  value={step.text}
                  onChange={(e) => update(step.uid, e.target.value)}
                  rows={3}
                  aria-label={`Step ${i + 1} message`}
                />
              </Card>
            ))}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button size="sm" onClick={() => toast.success('Sequence saved')}>
                <Save className="h-3.5 w-3.5" /> Save sequence
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => toast.success('Apply to multiple leads — coming soon (demo)')}
              >
                <Users className="h-3.5 w-3.5" /> Apply to multiple leads
              </Button>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  )
}

export function OutreachPage() {
  const [params] = useSearchParams()
  const preselectId = params.get('leadId')
  const [lead, setLead] = React.useState<LeadRow | null>(null)

  const preselect = useQuery({
    queryKey: ['outreach-preselect', preselectId],
    queryFn: () => leadsApi.get(preselectId as string),
    enabled: !!preselectId && !lead,
  })

  React.useEffect(() => {
    if (preselect.data && !lead) setLead(preselect.data)
  }, [preselect.data, lead])

  return (
    <div className="reveal">
      <PageHeader title="Outreach" />
      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <div className="space-y-5">
          <LeadPicker selected={lead} onSelect={setLead} />
          {lead && (
            <Card className="reveal p-4">
              <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                Selected lead
              </p>
              <p className="mt-1 inline-flex items-center gap-1.5 text-[15px] font-semibold text-[var(--color-text)]">
                <ConfidenceDot status={lead.row_confidence} />
                {lead.business_name}
              </p>
              <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">
                {lead.owner_name.value ?? 'Owner unknown'}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {lead.hot && (
                  <Badge className="bg-red-50 text-red-700">Hot</Badge>
                )}
                <Badge className="bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">
                  Score {lead.score ?? '—'}
                </Badge>
                <Badge className="bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">
                  Phone {lead.owner_phone.status}
                </Badge>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          {!lead ? (
            preselect.isLoading ? (
              <SectionCard title="Outreach message" className="reveal">
                <LoadingState label="Loading lead…" />
              </SectionCard>
            ) : (
              <SectionCard title="Outreach message" className="reveal">
                <EmptyState
                  icon={Mail}
                  title="Pick a lead to start"
                  message="Select a lead from the list to generate channel-specific outreach copy."
                />
              </SectionCard>
            )
          ) : (
            <>
              <MessageComposer lead={lead} />
              <SequenceBuilder lead={lead} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
