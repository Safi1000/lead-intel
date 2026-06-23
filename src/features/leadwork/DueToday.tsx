import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { manualLeadsApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { useAuth } from '../../hooks'
import { Card } from '../../components/ui/primitives'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import { StageSelect, FollowUpCell } from './controls'
import { canWorkLeads, isOverdue } from './workflow'
import type { LeadStage, ManualLead } from '../../api/types'

export function DueTodayPage() {
  const qc = useQueryClient()
  const { role } = useAuth()
  const canEdit = canWorkLeads(role)

  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['due-today'], queryFn: manualLeadsApi.dueToday })

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof manualLeadsApi.update>[1] }) => manualLeadsApi.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['due-today'] })
      qc.invalidateQueries({ queryKey: ['manual-leads'] })
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  const leads = data ?? []
  const { overdue, today } = useMemo(() => ({
    overdue: leads.filter((l) => isOverdue(l.next_follow_up)),
    today: leads.filter((l) => !isOverdue(l.next_follow_up)),
  }), [leads])

  const onStage = (id: string, stage: LeadStage) => patch.mutate({ id, body: { stage } })
  const onFollowUp = (id: string, date: string | null) => patch.mutate({ id, body: { next_follow_up: date } })

  return (
    <div className="reveal">
      <PageHeader title="Due today" subtitle="Your follow-ups due today and earlier. Work the list top to bottom." />

      {isLoading ? <LoadingState /> : isError ? <ErrorState onRetry={() => refetch()} /> : leads.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="All caught up" message="No follow-ups are due. Set a Next Follow-Up Date on a lead to schedule the next touch." />
      ) : (
        <div className="space-y-6">
          {overdue.length > 0 && (
            <Section title="Overdue" tone="overdue" count={overdue.length} leads={overdue} canEdit={canEdit} role={role} onStage={onStage} onFollowUp={onFollowUp} />
          )}
          {today.length > 0 && (
            <Section title="Due today" tone="today" count={today.length} leads={today} canEdit={canEdit} role={role} onStage={onStage} onFollowUp={onFollowUp} />
          )}
        </div>
      )}
    </div>
  )
}

function Section({ title, tone, count, leads, canEdit, role, onStage, onFollowUp }: {
  title: string; tone: 'overdue' | 'today'; count: number; leads: ManualLead[]; canEdit: boolean; role: string | null
  onStage: (id: string, s: LeadStage) => void; onFollowUp: (id: string, d: string | null) => void
}) {
  return (
    <div>
      <h2 className="mb-2 flex items-center gap-2 text-[14px] font-semibold">
        <CalendarClock className={tone === 'overdue' ? 'h-4 w-4 text-red-500' : 'h-4 w-4 text-amber-500'} />
        {title} <span className="tabular-nums text-[var(--color-text-muted)]">({count})</span>
      </h2>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                <th className="px-5 py-2.5 font-medium">Lead</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Next follow-up</th>
                <th className="px-3 py-2.5 font-medium">Batch</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3"><Link to={`/leads/manual/${l.id}`} className="font-medium hover:text-[var(--color-primary)]">{l.display_name}</Link></td>
                  <td className="px-3 py-3"><StageSelect stage={l.stage} role={role} disabled={!canEdit} onChange={(s) => onStage(l.id, s)} /></td>
                  <td className="px-3 py-3"><FollowUpCell value={l.next_follow_up} disabled={!canEdit} onChange={(d) => onFollowUp(l.id, d)} /></td>
                  <td className="px-3 py-3 text-[13px] text-[var(--color-text-muted)]">{l.batch_id ? <Link to={`/leads/batch/${l.batch_id}`} className="hover:text-[var(--color-primary)]">{l.template_name}</Link> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
