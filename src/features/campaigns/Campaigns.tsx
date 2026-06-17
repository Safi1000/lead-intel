import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Plus, Megaphone, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { campaignsApi } from '../../api/endpoints'
import type { Campaign } from '../../api/types'
import { formatNumber, formatPercent, formatMoney, cn } from '../../lib/utils'
import { relativeTime, absoluteTime } from '../../lib/time'
import { useRealtime } from '../../realtime/realtime'
import { Button, Card, Input, Badge } from '../../components/ui/primitives'
import { EmptyState, ErrorState, LoadingState, TableSkeleton } from '../../components/feedback'
import { PageHeader, SectionCard, ProgressBar } from '../shared/bits'

// ---- shared status styling ----
const CAMPAIGN_STATUS: Record<Campaign['status'], { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-slate-100 text-slate-600' },
  scheduled: { label: 'Scheduled', className: 'bg-indigo-50 text-indigo-700' },
  sending: { label: 'Sending', className: 'bg-amber-50 text-amber-700' },
  sent: { label: 'Sent', className: 'bg-green-50 text-green-700' },
}

function CampaignStatusBadge({ status }: { status: Campaign['status'] }) {
  const meta = CAMPAIGN_STATUS[status]
  const pulse = status === 'sending'
  return (
    <Badge className={meta.className}>
      <span className={cn('h-1.5 w-1.5 rounded-full bg-current', pulse && 'animate-pulse')} />
      {meta.label}
    </Badge>
  )
}

// ============================ List ============================
export function CampaignsPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => campaignsApi.list(),
  })

  return (
    <div className="reveal">
      <PageHeader
        title="Campaigns"
        subtitle="Bulk WhatsApp outreach to your enriched leads."
        actions={
          <Link to="/campaigns/new">
            <Button>
              <Plus className="h-4 w-4" /> New campaign
            </Button>
          </Link>
        }
      />

      <div className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {isLoading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : !data || data.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="No campaigns yet"
            message="Create your first WhatsApp campaign to reach delivered leads at scale."
            action={
              <Link to="/campaigns/new">
                <Button>New campaign</Button>
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th className="px-4 py-3 font-medium">Campaign</th>
                  <th className="px-4 py-3 font-medium">Template</th>
                  <th className="px-4 py-3 text-right font-medium">Audience</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Delivered · Read · Replied</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {data.map((c) => (
                  <tr key={c.id} className="cursor-default hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link to={`/campaigns/${c.id}`} className="font-medium hover:text-[var(--color-primary)]">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">{c.template}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNumber(c.audience_size)}</td>
                    <td className="px-4 py-3">
                      <CampaignStatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 tabular-nums text-[13px]">
                        <span className="text-[var(--color-text)]">{formatNumber(c.delivered)}</span>
                        <span className="text-[var(--color-text-muted)]">·</span>
                        <span className="text-[var(--color-text-secondary)]">{formatNumber(c.read)}</span>
                        <span className="text-[var(--color-text-muted)]">·</span>
                        <span className="font-medium text-[var(--color-primary)]">{formatNumber(c.replied)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]" title={absoluteTime(c.created_at)}>
                      {relativeTime(c.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================ Builder ============================
interface Segment {
  id: string
  label: string
  size: number
}
const SEGMENTS: Segment[] = [
  { id: 'hot-austin', label: 'Hot Austin roofers (120)', size: 120 },
  { id: 'all-delivered', label: 'All delivered (450)', size: 450 },
]
const COST_PER_MESSAGE_CENTS = 4 // $0.04 / message, demo pricing

export function NewCampaignPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [name, setName] = useState('')
  const [segmentId, setSegmentId] = useState<string>(SEGMENTS[0].id)
  const [templateId, setTemplateId] = useState<string>('')
  const [schedule, setSchedule] = useState<'now' | 'later'>('now')
  const [scheduledAt, setScheduledAt] = useState('')
  const [optInConfirmed, setOptInConfirmed] = useState(false)

  const templatesQ = useQuery({
    queryKey: ['campaign-templates'],
    queryFn: () => campaignsApi.templates(),
  })
  const approved = useMemo(
    () => (templatesQ.data ?? []).filter((t) => t.status === 'approved'),
    [templatesQ.data],
  )
  const selectedTemplate = approved.find((t) => t.id === templateId) ?? null
  const segment = SEGMENTS.find((s) => s.id === segmentId) ?? SEGMENTS[0]

  const create = useMutation({
    mutationFn: () =>
      campaignsApi.create({ name: name.trim(), template: selectedTemplate?.name ?? '' }),
    onSuccess: (c) => {
      toast.success('Campaign created')
      qc.invalidateQueries({ queryKey: ['campaigns'] })
      navigate(`/campaigns/${c.id}`)
    },
    onError: () => toast.error('Couldn’t create campaign'),
  })

  const templateApproved = !!selectedTemplate
  const scheduleOk = schedule === 'now' || scheduledAt.length > 0
  const canSend =
    name.trim().length > 0 && templateApproved && optInConfirmed && scheduleOk && !create.isPending

  const estCostCents = segment.size * COST_PER_MESSAGE_CENTS

  return (
    <div className="reveal">
      <PageHeader
        title="New campaign"
        subtitle="Build, review compliance, and send a WhatsApp blast."
        actions={
          <Link to="/campaigns">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          </Link>
        }
      />

      {templatesQ.isError ? (
        <ErrorState onRetry={() => templatesQ.refetch()} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <SectionCard title="Campaign details">
              <div className="space-y-4 p-5">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--color-text)]">Campaign name</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="June roofing follow-up"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--color-text)]">Audience</label>
                  <select
                    value={segmentId}
                    onChange={(e) => setSegmentId(e.target.value)}
                    className="h-9 w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
                  >
                    {SEGMENTS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
                    Saved segment from your enriched leads.
                  </p>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--color-text)]">Template</label>
                  {templatesQ.isLoading ? (
                    <div className="h-9 w-full animate-pulse rounded-[8px] bg-[var(--color-surface-2)]" />
                  ) : approved.length === 0 ? (
                    <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[13px] text-[var(--color-text-secondary)]">
                      No approved templates yet. Only Meta-approved templates can be sent.
                    </div>
                  ) : (
                    <select
                      value={templateId}
                      onChange={(e) => setTemplateId(e.target.value)}
                      className="h-9 w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
                    >
                      <option value="">Select an approved template…</option>
                      {approved.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} · {t.category}
                        </option>
                      ))}
                    </select>
                  )}
                  {selectedTemplate && (
                    <div className="mt-3 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
                      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                        Preview
                      </p>
                      <TemplatePreview body={selectedTemplate.body} />
                    </div>
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--color-text)]">Schedule</label>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center gap-2 text-sm text-[var(--color-text)]">
                      <input
                        type="radio"
                        name="schedule"
                        checked={schedule === 'now'}
                        onChange={() => setSchedule('now')}
                      />
                      Send now
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-[var(--color-text)]">
                      <input
                        type="radio"
                        name="schedule"
                        checked={schedule === 'later'}
                        onChange={() => setSchedule('later')}
                      />
                      Schedule for later
                    </label>
                    {schedule === 'later' && (
                      <input
                        type="datetime-local"
                        value={scheduledAt}
                        onChange={(e) => setScheduledAt(e.target.value)}
                        className="h-9 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
                      />
                    )}
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>

          {/* Compliance + summary rail */}
          <div className="space-y-5">
            <SectionCard title="Pre-send checklist">
              <div className="space-y-3 p-5 text-sm">
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={optInConfirmed}
                    onChange={(e) => setOptInConfirmed(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-[var(--color-text)]">
                    Opt-in confirmed — all recipients consented to WhatsApp messaging.
                  </span>
                </label>
                <div className="flex items-start gap-2.5">
                  {templateApproved ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                  ) : (
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  )}
                  <span className={cn('text-[var(--color-text)]', !templateApproved && 'text-[var(--color-text-secondary)]')}>
                    {templateApproved ? 'Template approved by Meta.' : 'Select an approved template.'}
                  </span>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Estimated reach">
              <div className="space-y-2 p-5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--color-text-secondary)]">Recipients</span>
                  <span className="font-medium tabular-nums text-[var(--color-text)]">
                    {formatNumber(segment.size)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--color-text-secondary)]">Est. cost</span>
                  <span className="font-medium tabular-nums text-[var(--color-text)]">
                    {formatMoney(estCostCents)}
                  </span>
                </div>
                <p className="pt-1 text-[12px] text-[var(--color-text-muted)]">
                  Based on {formatMoney(COST_PER_MESSAGE_CENTS)} per message.
                </p>
              </div>
            </SectionCard>

            <Button className="w-full" disabled={!canSend} loading={create.isPending} onClick={() => create.mutate()}>
              Send campaign
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function TemplatePreview({ body }: { body: string }) {
  // Highlight {{1}} style variables.
  const parts = body.split(/(\{\{\d+\}\})/g)
  return (
    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-text)]">
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

// ============================ Detail ============================
interface FunnelBumps {
  delivered: number
  read: number
  replied: number
}

export function CampaignDetailPage() {
  const { id = '' } = useParams()
  const [bumps, setBumps] = useState<FunnelBumps>({ delivered: 0, read: 0, replied: 0 })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => campaignsApi.get(id),
    enabled: !!id,
  })

  // Optional realtime bumps — safe no-op when no events arrive.
  useRealtime(id ? `campaign:${id}` : null, (payload) => {
    const p = (payload ?? {}) as Partial<FunnelBumps>
    setBumps((prev) => ({
      delivered: prev.delivered + (p.delivered ?? 0),
      read: prev.read + (p.read ?? 0),
      replied: prev.replied + (p.replied ?? 0),
    }))
  })

  if (isLoading) return <LoadingState label="Loading campaign…" />
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />

  const audience = Math.max(1, data.audience_size)
  const delivered = data.delivered + bumps.delivered
  const read = data.read + bumps.read
  const replied = data.replied + bumps.replied

  const funnelData = [
    { stage: 'Audience', count: data.audience_size, fill: 'var(--color-text-muted)' },
    { stage: 'Delivered', count: delivered, fill: 'var(--color-primary)' },
    { stage: 'Read', count: read, fill: '#6366f1' },
    { stage: 'Replied', count: replied, fill: 'var(--color-signal)' },
  ]

  const messageRows = [
    { label: 'Replied', count: replied, status: 'read' as const },
    { label: 'Read, no reply', count: Math.max(0, read - replied), status: 'read' as const },
    { label: 'Delivered, unread', count: Math.max(0, delivered - read), status: 'delivered' as const },
    { label: 'Not delivered', count: Math.max(0, data.audience_size - delivered), status: 'sent' as const },
  ]

  return (
    <div className="reveal">
      <PageHeader
        title={data.name}
        subtitle={
          <span>
            Template <span className="font-medium text-[var(--color-text)]">{data.template}</span> ·{' '}
            {formatNumber(data.audience_size)} recipients
          </span>
        }
        actions={
          <Link to="/campaigns">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4" /> Campaigns
            </Button>
          </Link>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <CounterCard label="Delivered" value={delivered} ratio={delivered / audience} />
        <CounterCard label="Read" value={read} ratio={read / audience} />
        <CounterCard label="Replied" value={replied} ratio={replied / audience} accent />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Funnel">
          <div className="space-y-4 p-5">
            <FunnelRow label="Delivered" value={delivered} total={audience} />
            <FunnelRow label="Read" value={read} total={audience} />
            <FunnelRow label="Replied" value={replied} total={audience} />
          </div>
        </SectionCard>

        <SectionCard title="Funnel chart">
          <div className="p-5" style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="stage" tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} />
                <YAxis tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} width={40} />
                <RTooltip cursor={{ fill: 'var(--color-surface-2)' }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {funnelData.map((d) => (
                    <Cell key={d.stage} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div className="mt-5">
        <SectionCard title="Message status">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th className="px-5 py-3 font-medium">Bucket</th>
                  <th className="px-5 py-3 font-medium">State</th>
                  <th className="px-5 py-3 text-right font-medium">Count</th>
                  <th className="px-5 py-3 text-right font-medium">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {messageRows.map((r) => (
                  <tr key={r.label} className="hover:bg-slate-50">
                    <td className="px-5 py-3 text-[var(--color-text)]">{r.label}</td>
                    <td className="px-5 py-3">
                      <Badge className="bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">{r.status}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">{formatNumber(r.count)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-[var(--color-text-secondary)]">
                      {formatPercent(r.count / audience)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}

function CounterCard({
  label,
  value,
  ratio,
  accent,
}: {
  label: string
  value: number
  ratio: number
  accent?: boolean
}) {
  return (
    <Card className="p-5">
      <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-2 flex items-end justify-between">
        <span
          className={cn(
            'text-[28px] font-bold tabular-nums leading-none',
            accent ? 'text-[var(--color-signal)]' : 'text-[var(--color-text)]',
          )}
        >
          {formatNumber(value)}
        </span>
        <span className="text-[13px] tabular-nums text-[var(--color-text-secondary)]">{formatPercent(ratio)}</span>
      </div>
    </Card>
  )
}

function FunnelRow({ label, value, total }: { label: string; value: number; total: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[13px]">
        <span className="text-[var(--color-text-secondary)]">{label}</span>
        <span className="tabular-nums text-[var(--color-text)]">
          {formatNumber(value)} <span className="text-[var(--color-text-muted)]">({formatPercent(value / total)})</span>
        </span>
      </div>
      <ProgressBar value={value / total} />
    </div>
  )
}
