import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { providerApi, type ProviderRow } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { Dialog } from '../../components/ui/Dialog'
import { ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader, StatCard } from '../shared/bits'

const COST_PER_LEAD = 0.02 // blended API cost estimate (matches the discovery preview)
const billedOf = (r: ProviderRow) => r.monthly_fee + r.delivered_30d * r.price_per_lead
const costOf = (r: ProviderRow) => r.delivered_30d * COST_PER_LEAD

export function ProviderPage() {
  const qc = useQueryClient()
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['provider-overview'], queryFn: () => providerApi.overview() })
  const [edit, setEdit] = useState<ProviderRow | null>(null)
  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState onRetry={() => refetch()} />

  const rows = data ?? []
  const totBilled = rows.reduce((s, r) => s + billedOf(r), 0)
  const totCost = rows.reduce((s, r) => s + costOf(r), 0)

  return (
    <div className="reveal">
      <PageHeader title="Provider console" subtitle="All tenants — delivery, cost and margin (last 30 days)." />
      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Tenants" value={rows.length} />
        <StatCard label="Billed (30d)" value={`$${Math.round(totBilled).toLocaleString()}`} />
        <StatCard label="Est. cost (30d)" value={`$${Math.round(totCost).toLocaleString()}`} />
        <StatCard label="Margin" value={`$${Math.round(totBilled - totCost).toLocaleString()}`} />
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                <th className="px-5 py-2.5 font-medium">Tenant</th>
                <th className="px-3 py-2.5 font-medium tabular-nums">Leads</th>
                <th className="px-3 py-2.5 font-medium tabular-nums">30d</th>
                <th className="px-3 py-2.5 font-medium tabular-nums">Booked</th>
                <th className="px-3 py-2.5 font-medium">Plan</th>
                <th className="px-3 py-2.5 font-medium tabular-nums">Billed</th>
                <th className="px-3 py-2.5 font-medium tabular-nums">Cost</th>
                <th className="px-3 py-2.5 font-medium tabular-nums">Margin</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const b = billedOf(r), c = costOf(r)
                return (
                  <tr key={r.org_id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]">
                    <td className="px-5 py-3 font-medium">{r.org_name}</td>
                    <td className="px-3 py-3 tabular-nums text-[var(--color-text-secondary)]">{r.leads_total}</td>
                    <td className="px-3 py-3 tabular-nums text-[var(--color-text-secondary)]">{r.delivered_30d}</td>
                    <td className="px-3 py-3 tabular-nums text-[var(--color-text-secondary)]">{r.booked}</td>
                    <td className="px-3 py-3 text-[var(--color-text-secondary)]">{r.plan}</td>
                    <td className="px-3 py-3 tabular-nums">${Math.round(b).toLocaleString()}</td>
                    <td className="px-3 py-3 tabular-nums text-[var(--color-text-secondary)]">${Math.round(c).toLocaleString()}</td>
                    <td className={`px-3 py-3 tabular-nums font-semibold ${b - c >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>${Math.round(b - c).toLocaleString()}</td>
                    <td className="px-3 py-3"><Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Billing</Button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="mt-3 text-[12px] text-[var(--color-text-muted)]">Cost is estimated at ~${COST_PER_LEAD.toFixed(2)}/delivered lead. Set each tenant's plan &amp; rate with the Billing button.</p>
      {edit && <BillingDialog row={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['provider-overview'] }) }} />}
    </div>
  )
}

function BillingDialog({ row, onClose, onSaved }: { row: ProviderRow; onClose: () => void; onSaved: () => void }) {
  const [plan, setPlan] = useState(row.plan)
  const [ppl, setPpl] = useState(String(row.price_per_lead))
  const [fee, setFee] = useState(String(row.monthly_fee))
  const [credits, setCredits] = useState(String(row.credits_remaining))
  const save = useMutation({
    mutationFn: () => providerApi.setBilling(row.org_id, { plan, price_per_lead: Number(ppl) || 0, monthly_fee: Number(fee) || 0, credits_remaining: Number(credits) || 0 }),
    onSuccess: () => { toast.success('Billing saved'); onSaved() },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Billing — ${row.org_name}`} description="Set the tenant's plan and rate. Margin updates from delivered volume.">
      <div className="space-y-3">
        <div>
          <Label htmlFor="b-plan">Plan</Label>
          <select id="b-plan" value={plan} onChange={(e) => setPlan(e.target.value)} className="h-9 w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm">
            <option value="per_lead">Per lead</option><option value="monthly">Monthly</option><option value="hybrid">Hybrid</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="b-ppl">Price / lead</Label><Input id="b-ppl" type="number" min={0} value={ppl} onChange={(e) => setPpl(e.target.value)} /></div>
          <div><Label htmlFor="b-fee">Monthly fee</Label><Input id="b-fee" type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} /></div>
        </div>
        <div><Label htmlFor="b-cr">Credits remaining</Label><Input id="b-cr" type="number" min={0} value={credits} onChange={(e) => setCredits(e.target.value)} /></div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
        </div>
      </div>
    </Dialog>
  )
}
