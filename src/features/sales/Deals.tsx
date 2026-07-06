import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { dealsApi, usersApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { Card } from '../../components/ui/primitives'
import { ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import { DEAL_STAGES, type DealStage } from '../../api/types'

const STAGE_LABEL: Record<DealStage, string> = { new: 'New', contacted: 'Contacted', qualified: 'Qualified', proposal: 'Proposal', won: 'Won', lost: 'Lost' }

/** §10 closer pipeline kanban — deals by stage; move via the per-card selector (no drag-drop dep). */
export function DealsPage() {
  const qc = useQueryClient()
  const { data: deals, isLoading, isError, refetch } = useQuery({ queryKey: ['deals-board'], queryFn: () => dealsApi.board() })
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list() })
  const move = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: DealStage }) => dealsApi.updateStage(id, stage),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deals-board'] }),
    onError: (e) => toast.error(normalizeError(e).message),
  })
  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState onRetry={() => refetch()} />

  const nameFor = (id: string | null) => (id ? users?.find((u) => u.id === id)?.name ?? 'Closer' : '—')
  const byStage = (s: DealStage) => (deals ?? []).filter((d) => d.stage === s)
  const open = (deals ?? []).filter((d) => d.stage !== 'won' && d.stage !== 'lost').reduce((s, d) => s + Number(d.value ?? 0), 0)
  const won = (deals ?? []).filter((d) => d.stage === 'won').reduce((s, d) => s + Number(d.value ?? 0), 0)

  return (
    <div className="reveal">
      <PageHeader title="Deals" subtitle={`$${Math.round(open).toLocaleString()} in open pipeline · $${Math.round(won).toLocaleString()} won`} />
      <div className="flex gap-3 overflow-x-auto pb-4">
        {DEAL_STAGES.map((s) => (
          <div key={s} className="w-64 shrink-0">
            <div className="mb-2 flex items-center justify-between px-1 text-[13px] font-semibold">
              <span>{STAGE_LABEL[s]}</span>
              <span className="tabular-nums text-[var(--color-text-muted)]">{byStage(s).length}</span>
            </div>
            <div className="space-y-2">
              {byStage(s).map((d) => (
                <Card key={d.id} className="p-3">
                  <p className="mb-1 truncate text-[13px] font-medium">{d.lead_name}</p>
                  <p className="mb-1 text-[15px] font-semibold tabular-nums text-[var(--color-primary)]">{d.value != null ? `$${Math.round(d.value).toLocaleString()}` : '—'}</p>
                  <p className="mb-2 text-[11px] text-[var(--color-text-muted)]">{nameFor(d.closer_id)}</p>
                  <select value={d.stage} onChange={(e) => move.mutate({ id: d.id, stage: e.target.value as DealStage })}
                    className="h-8 w-full rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 text-[12px] capitalize">
                    {DEAL_STAGES.map((x) => <option key={x} value={x}>{STAGE_LABEL[x]}</option>)}
                  </select>
                </Card>
              ))}
              {byStage(s).length === 0 && <p className="px-1 text-[12px] text-[var(--color-text-muted)]">—</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
