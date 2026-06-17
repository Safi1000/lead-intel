import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Copy, Download, ExternalLink, Globe, Megaphone } from 'lucide-react'
import { leadsApi } from '../../api/endpoints'
import { absoluteTime } from '../../lib/time'
import { Button, Card } from '../../components/ui/primitives'
import { ConfidenceBadge, ConfidenceDot, FieldRow, SourceLink } from '../../components/confidence'
import { ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import { cn } from '../../lib/utils'
import { toast } from 'sonner'

function DetailCard({ title, children, locked }: { title: string; children: React.ReactNode; locked?: string }) {
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {locked && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-500">{locked}</span>}
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
    <div>
      <PageHeader
        title={<span className="flex items-center gap-2"><button onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft className="h-5 w-5" /></button>{lead.business_name}</span>}
        subtitle={<span className="flex items-center gap-2">Roofing · <Link to={`/runs/${lead.run_id}/leads`} className="text-[var(--color-primary)] hover:underline">back to list</Link></span>}
        actions={
          <>
            <Button variant="outline" onClick={copyContact}><Copy className="h-4 w-4" /> Copy contact</Button>
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
                {lead.wayback_url && <a href={lead.wayback_url} target="_blank" rel="noreferrer" className="text-[12px] text-[var(--color-text-muted)] underline">History</a>}
              </div>
            </div>
            <div className="flex items-center justify-between py-2.5 border-b border-[var(--color-border)]">
              <span className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Ad activity</span>
              {lead.ad_activity === 'active' ? (
                <a href={lead.ad_link ?? '#'} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-[var(--c-probable)] hover:underline"><Megaphone className="h-4 w-4" /> Active <ExternalLink className="h-3 w-3" /></a>
              ) : (
                <span className="text-sm text-[var(--color-text-muted)]">No active ads</span>
              )}
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Social</span>
              <div className="flex gap-2">
                {lead.socials.length ? lead.socials.map((s) => <span key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-[12px] capitalize">{s}</span>) : <span className="text-sm text-[var(--color-text-muted)]">Not found</span>}
              </div>
            </div>
          </DetailCard>

          <DetailCard title="Marketing signals" locked="Phase 2">
            <div className="grid grid-cols-3 gap-4 py-4 opacity-70">
              <Signal label="Posting" value={lead.marketing_signals?.posting_frequency ?? '—'} />
              <Signal label="Last post" value={lead.marketing_signals?.last_post_at ? absoluteTime(lead.marketing_signals.last_post_at).split(' at')[0] : '—'} />
              <Signal label="Sentiment" value={lead.marketing_signals?.review_sentiment ?? '—'} />
            </div>
          </DetailCard>
        </div>

        {/* Sidebar: sources & confidence panel */}
        <div className="space-y-6">
          <DetailCard title="AI insight" locked="Phase 2/3">
            <p className="py-4 text-sm text-[var(--color-text-muted)]">Outreach angle, generated opener, and score rationale appear here once AI scoring is enabled.</p>
          </DetailCard>

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

          <DetailCard title="Notes &amp; tags" locked="Phase 2">
            <div className="py-4">
              <div className="flex items-center gap-2"><ConfidenceDot status="missing" /><span className="text-sm text-[var(--color-text-muted)]">Notes &amp; tagging arrive in Phase 2.</span></div>
            </div>
          </DetailCard>
        </div>
      </div>
    </div>
  )
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  )
}
