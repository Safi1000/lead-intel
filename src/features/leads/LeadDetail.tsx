import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Clock, Copy, Download, ExternalLink, Globe, Megaphone, PenLine, Plus, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { leadsApi, aiApi } from '../../api/endpoints'
import { absoluteTime } from '../../lib/time'
import { Button, Card, Textarea } from '../../components/ui/primitives'
import { ConfidenceBadge, FieldRow, SourceLink } from '../../components/confidence'
import { ScoreBadge, HotFlag } from '../../components/score/ScoreBadge'
import { StreamingText, useStream, GenerationControls, AIProviderBadge, RationaleDisclosure } from '../../components/ai/streaming'
import { ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import { cn } from '../../lib/utils'
import type { LeadDetail } from '../../api/types'

function DetailCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {action}
      </div>
      <div className="px-5">{children}</div>
    </Card>
  )
}

export function LeadDetailPage() {
  const { leadId } = useParams()
  const navigate = useNavigate()
  const { data: lead, isLoading, isError, refetch } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: () => leadsApi.get(leadId as string),
  })

  if (isLoading) return <LoadingState label="Loading lead…" />
  if (isError || !lead) return <ErrorState title="Lead not found" message="This lead may have been removed." onRetry={() => refetch()} />

  function copyContact() {
    const text = `${lead!.business_name}\nOwner: ${lead!.owner_name.value ?? '—'}\nPhone: ${lead!.owner_phone.value ?? lead!.business_phone.value ?? '—'}\nEmail: ${lead!.email.value ?? '—'}`
    navigator.clipboard?.writeText(text)
    toast.success('Contact copied')
  }

  return (
    <div className="reveal">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <button onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft className="h-5 w-5" /></button>
            {lead.business_name}
            <ScoreBadge score={lead.score} />
            {lead.hot && <HotFlag />}
          </span>
        }
        subtitle={<span className="flex items-center gap-2">Roofing · <Link to={`/runs/${lead.run_id}/leads`} className="text-[var(--color-primary)] hover:underline">back to list</Link></span>}
        actions={
          <>
            <Link to={`/outreach?leadId=${lead.id}`}><Button variant="outline"><PenLine className="h-4 w-4" /> Outreach</Button></Link>
            <Button variant="outline" onClick={copyContact}><Copy className="h-4 w-4" /> Copy</Button>
            <Button variant="outline"><Download className="h-4 w-4" /> Export</Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <DetailCard title="Identity">
            <FieldRow label="Owner name" field={lead.owner_name} />
            <FieldRow label="Business name" field={{ value: lead.business_name, source: 'Google Business Profile', confidence: 'verified', status: 'present' }} />
            <FieldRow label="Address" field={lead.address} />
            <FieldRow label="Zip" field={lead.zip} />
          </DetailCard>

          <DetailCard title="Contact">
            <FieldRow label="Business phone" field={lead.business_phone} href={lead.business_phone.value ? `tel:${lead.business_phone.value}` : undefined} />
            <FieldRow label="Owner phone" field={lead.owner_phone} href={lead.owner_phone.value ? `tel:${lead.owner_phone.value}` : undefined} />
            <FieldRow label="Business email" field={lead.email} href={lead.email.value ? `mailto:${lead.email.value}` : undefined} />
            <FieldRow label="Owner email" field={lead.owner_email} href={lead.owner_email.value ? `mailto:${lead.owner_email.value}` : undefined} />
            {lead.linkedin && <FieldRow label="Owner LinkedIn" field={lead.linkedin} href={lead.linkedin.source_url ?? undefined} />}
          </DetailCard>

          <DetailCard title="Digital footprint">
            <div className="flex flex-col gap-1 border-b border-[var(--color-border)] py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Website</span>
              <div className="flex flex-wrap items-center gap-2">
                {lead.website.value ? (
                  <a href={lead.website.value} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-[var(--color-primary)] hover:underline">{lead.website.value}<ExternalLink className="h-3 w-3" /></a>
                ) : (
                  <span className="text-sm italic text-[var(--color-text-muted)]">Not found</span>
                )}
                {lead.website_live != null && (
                  <span className={cn('inline-flex items-center gap-1 text-[12px]', lead.website_live ? 'text-[var(--c-verified)]' : 'text-[var(--c-unverified)]')}>
                    <Globe className="h-3.5 w-3.5" />{lead.website_live ? 'Live' : 'Down'}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between border-b border-[var(--color-border)] py-2.5">
              <span className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Ad activity</span>
              {lead.ad_activity === 'active' ? (
                <a href={lead.ad_link ?? '#'} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-[var(--c-probable)] hover:underline"><Megaphone className="h-4 w-4" /> Active <ExternalLink className="h-3 w-3" /></a>
              ) : (
                <span className="text-sm text-[var(--color-text-muted)]">No active ads</span>
              )}
            </div>
            <div className="flex items-center justify-between border-b border-[var(--color-border)] py-2.5">
              <span className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Tech stack</span>
              <div className="flex flex-wrap justify-end gap-1.5">
                {lead.tech_stack?.length ? lead.tech_stack.map((t) => <span key={t} className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[12px]">{t}</span>) : <span className="text-sm text-[var(--color-text-muted)]">—</span>}
              </div>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Social</span>
              <div className="flex gap-2">
                {lead.socials.length ? lead.socials.map((s) => <span key={s} className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[12px] capitalize">{s}</span>) : <span className="text-sm text-[var(--color-text-muted)]">Not found</span>}
              </div>
            </div>
          </DetailCard>

          <DetailCard title="Marketing signals">
            <div className="grid grid-cols-2 gap-4 py-4 sm:grid-cols-4">
              <Signal label="Posting" value={lead.marketing_signals?.posting_frequency ?? '—'} />
              <Signal label="Last post" value={lead.marketing_signals?.last_post_at ? absoluteTime(lead.marketing_signals.last_post_at).split(' at')[0] : '—'} />
              <Signal label="Business age" value={lead.business_age?.value ?? '—'} />
              <Signal label="Sentiment" value={lead.sentiment ? `${lead.sentiment.score}/100` : '—'} />
            </div>
            {lead.sentiment?.themes.length ? (
              <div className="flex flex-wrap gap-1.5 pb-4">
                {lead.sentiment.themes.map((t) => <span key={t} className="rounded-full bg-[var(--c-verified-bg)] px-2 py-0.5 text-[12px] capitalize text-[var(--c-verified-text)]">{t}</span>)}
              </div>
            ) : null}
          </DetailCard>

          {/* P3-6 add-ons */}
          <DetailCard title="Enrichment add-ons" action={<span className="rounded-full bg-[var(--c-verified-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--c-verified-text)]">Enabled</span>}>
            <div className="grid gap-4 py-4 sm:grid-cols-3">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Property (roofing)</p>
                <p className="mt-1 text-sm">Roof age: {lead.property?.roof_age ?? '—'}</p>
                <p className="text-sm">Last permit: {lead.property?.last_permit ?? '—'}</p>
                <p className="text-sm">Storm activity: {lead.property?.storm_activity ?? '—'}</p>
              </div>
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Competitors</p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {lead.competitors?.slice(0, 3).map((c) => <li key={c.name} className="flex justify-between gap-2"><span className="truncate">{c.name}</span><span className="tabular-nums text-[var(--color-text-muted)]">{c.rating.toFixed(1)}★</span></li>)}
                </ul>
              </div>
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Domain signals</p>
                <p className="mt-1 text-sm">Expiry: {lead.domain_signals?.expiry ?? '—'}</p>
                <p className="text-sm">SSL: {lead.domain_signals?.ssl ?? '—'}</p>
                <p className="text-sm">Updated: {lead.domain_signals?.last_update ?? '—'}</p>
              </div>
            </div>
          </DetailCard>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <AIInsightCard lead={lead} />
          <PredictiveCard leadId={lead.id} />

          <Card>
            <div className="border-b border-[var(--color-border)] px-5 py-3"><h2 className="text-[15px] font-semibold">Sources &amp; confidence</h2></div>
            <ul className="divide-y divide-[var(--color-border)]">
              {lead.sources.map((s) => (
                <li key={s.field} className="flex items-center justify-between gap-2 px-5 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{s.field}</p>
                    <SourceLink source={s.source} url={s.source_url} />
                  </div>
                  <ConfidenceBadge status={s.confidence} />
                </li>
              ))}
            </ul>
          </Card>

          <NotesTags lead={lead} />
        </div>
      </div>
    </div>
  )
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  )
}

function AIInsightCard({ lead }: { lead: LeadDetail }) {
  const [nonce, setNonce] = useState(0)
  const { data, refetch, isFetching } = useQuery({
    queryKey: ['outreach-angle', lead.id, nonce],
    queryFn: () => aiApi.outreachAngle(lead.id),
  })
  const { shown, streaming, stop } = useStream(data?.text ?? null, [data])

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold"><Sparkles className="h-4 w-4 text-[var(--color-primary)]" /> AI insight</h2>
        {data && <AIProviderBadge provider={data.provider} />}
      </div>
      <div className="px-5 py-4">
        {isFetching && !data ? (
          <p className="text-sm text-[var(--color-text-muted)]">Generating outreach angle…</p>
        ) : (
          <>
            <StreamingText text={shown} streaming={streaming} onStop={stop} />
            <GenerationControls onRegenerate={() => { setNonce((n) => n + 1); refetch() }} copyValue={data?.text} />
            <RationaleDisclosure title="Why this angle">
              Score {lead.score}/100 driven by {lead.website_live ? 'an active' : 'an absent'} website and {lead.socials.length ? 'some' : 'minimal'} social presence. Lower digital sophistication → higher receptiveness to lead-gen outreach.
            </RationaleDisclosure>
          </>
        )}
      </div>
    </Card>
  )
}

function PredictiveCard({ leadId }: { leadId: string }) {
  const { data } = useQuery({ queryKey: ['predictive', leadId], queryFn: () => aiApi.predictive(leadId) })
  return (
    <Card>
      <div className="border-b border-[var(--color-border)] px-5 py-3"><h2 className="flex items-center gap-1.5 text-[15px] font-semibold"><Clock className="h-4 w-4 text-[var(--color-primary)]" /> Best time to contact</h2></div>
      <div className="px-5 py-4">
        {!data ? (
          <p className="text-sm text-[var(--color-text-muted)]">Loading recommendations…</p>
        ) : (
          <>
            <ul className="space-y-2">
              {data.best_windows.map((w) => (
                <li key={w.day} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{w.day} · {w.window}</span>
                  <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[12px] tabular-nums text-[var(--color-text-secondary)]">{Math.round(w.confidence * 100)}%</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[13px] text-[var(--color-text-secondary)]">{data.seasonal}</p>
          </>
        )}
      </div>
    </Card>
  )
}

function NotesTags({ lead }: { lead: LeadDetail }) {
  const qc = useQueryClient()
  const [notes, setNotes] = useState(lead.notes ?? '')
  const [tags, setTags] = useState<string[]>(lead.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  useEffect(() => { setNotes(lead.notes ?? ''); setTags(lead.tags ?? []) }, [lead.id])

  const save = useMutation({
    mutationFn: (body: { notes?: string; tags?: string[] }) => leadsApi.update(lead.id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead', lead.id] }),
  })

  function addTag() {
    const t = tagInput.trim().toLowerCase()
    if (t && !tags.includes(t)) {
      const next = [...tags, t]
      setTags(next)
      save.mutate({ tags: next })
    }
    setTagInput('')
  }
  function removeTag(t: string) {
    const next = tags.filter((x) => x !== t)
    setTags(next)
    save.mutate({ tags: next })
  }

  return (
    <Card>
      <div className="border-b border-[var(--color-border)] px-5 py-3"><h2 className="text-[15px] font-semibold">Notes &amp; tags</h2></div>
      <div className="space-y-3 px-5 py-4">
        <div>
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[12px] font-medium text-[var(--color-primary)]">
                {t}
                <button onClick={() => removeTag(t)} aria-label={`Remove ${t}`}><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
              placeholder="Add a tag…"
              className="h-8 flex-1 rounded-[8px] border border-[var(--color-border)] px-2.5 text-[13px] focus:border-[var(--color-primary)] focus-visible:outline-none"
            />
            <Button size="sm" variant="outline" onClick={addTag}><Plus className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
        <div>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== (lead.notes ?? '') && save.mutate({ notes })}
            rows={3}
            placeholder="Add a note (autosaves)…"
          />
          <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">{save.isPending ? 'Saving…' : 'Autosaves on blur'}</p>
        </div>
      </div>
    </Card>
  )
}
