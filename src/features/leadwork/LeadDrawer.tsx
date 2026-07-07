import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { ExternalLink, Globe, MapPin, Phone } from 'lucide-react'
import { dispositionsApi, manualLeadsApi } from '../../api/endpoints'
import { Sheet } from '../../components/ui/Sheet'
import { Button } from '../../components/ui/primitives'
import { LoadingState } from '../../components/feedback'

const href = (url: string) => (url.startsWith('http') ? url : `https://${url}`)

/** Quick-look drawer opened from the lead table (spec §10 list-and-drawer). Deep work stays on the full page. */
export function LeadDrawer({ leadId, onClose }: { leadId: string | null; onClose: () => void }) {
  const { data: lead, isLoading } = useQuery({ queryKey: ['manual-lead', leadId], queryFn: () => manualLeadsApi.get(leadId as string), enabled: !!leadId })
  const { data: dispositions } = useQuery({ queryKey: ['dispositions', leadId], queryFn: () => dispositionsApi.list(leadId as string), enabled: !!leadId })
  const d = lead?.data ?? {}

  return (
    <Sheet open={!!leadId} onClose={onClose} title={lead?.display_name ?? 'Lead'}>
      {isLoading || !lead ? <LoadingState /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-[12px]">
            {lead.lifecycle_state && <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 font-medium">{lead.lifecycle_state}</span>}
            <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5">{lead.attempt_count} attempts</span>
            {lead.dnc && <span className="rounded-full bg-red-500/10 px-2 py-0.5 font-medium text-red-600 dark:text-red-400">DNC</span>}
          </div>

          <div className="space-y-2 text-sm">
            {d['Phone'] && <div className="flex items-center gap-2"><Phone className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" /><a href={`tel:${d['Phone']}`} className="text-[var(--color-primary)]">{d['Phone']}</a></div>}
            {d['Website'] && <div className="flex items-center gap-2"><Globe className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" /><a href={href(d['Website'])} target="_blank" rel="noreferrer" className="truncate text-[var(--color-primary)]">{d['Website']}</a></div>}
            {(d['City'] || d['State']) && <div className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />{[d['City'], d['State']].filter(Boolean).join(', ')}</div>}
            {d['Business Hours'] && <div className="text-[13px] text-[var(--color-text-secondary)]">Hours: {d['Business Hours']}</div>}
            {d['Best Time to Call (PKT)'] && <div className="text-[13px] text-[var(--color-text-secondary)]">Best time (PKT): {d['Best Time to Call (PKT)']}</div>}
          </div>

          {(dispositions?.length ?? 0) > 0 && (
            <div>
              <p className="mb-1 text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Recent outcomes</p>
              <div className="space-y-1">
                {(dispositions ?? []).slice(0, 5).map((ev) => (
                  <div key={ev.id} className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="truncate">{ev.tier1}{ev.tier2 ? ` → ${ev.tier2}` : ''}</span>
                    <span className="shrink-0 text-[var(--color-text-muted)]">{formatDistanceToNow(new Date(ev.created_at), { addSuffix: true })}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Link to={`/leads/manual/${lead.id}`} onClick={onClose}>
            <Button variant="outline" className="w-full"><ExternalLink className="h-4 w-4" /> Open full detail</Button>
          </Link>
        </div>
      )}
    </Sheet>
  )
}
