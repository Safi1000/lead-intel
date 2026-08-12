import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SlidersHorizontal, Target } from 'lucide-react'
import { floorConfigApi, progressApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { LoadingState } from '../../components/feedback'

/** Manager/SA set the org-wide monthly lead goal (leads each setter should mark as done
 *  in a month). This is the only goal in the product — there is no daily or weekly target. */
export function GoalsSettingsPage() {
  const qc = useQueryClient()
  const { data: goal, isLoading } = useQuery({ queryKey: ['monthly-goal'], queryFn: progressApi.getGoal })
  const [value, setValue] = useState('')
  useEffect(() => { if (goal != null) setValue(String(goal)) }, [goal])

  const save = useMutation({
    mutationFn: () => progressApi.setGoal(Number(value) || 0),
    onSuccess: () => {
      toast.success('Monthly goal saved')
      qc.invalidateQueries({ queryKey: ['monthly-goal'] })
      qc.invalidateQueries({ queryKey: ['my-progress'] })
      qc.invalidateQueries({ queryKey: ['setter-progress'] })
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  if (isLoading) return <LoadingState />

  return (
    <div className="space-y-6">
      <Card className="max-w-md p-5">
        <div className="mb-1 flex items-center gap-2">
          <Target className="h-5 w-5 text-[var(--color-primary)]" />
          <h2 className="text-[16px] font-semibold">Monthly lead goal</h2>
        </div>
        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
          How many leads each setter should mark as <span className="font-medium">done</span> in a calendar month.
          Progress is counted from the 1st and shown on the Progress page.
        </p>
        <Label htmlFor="goal">Leads per setter per month</Label>
        <div className="flex items-center gap-2">
          <Input id="goal" type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} className="w-32" />
          <Button onClick={() => save.mutate()} loading={save.isPending}>Save</Button>
        </div>
        <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">Set to 0 to disable goal tracking.</p>
      </Card>

      <FloorControlsCard />
    </div>
  )
}

/** §6 floor controls — editable per org. WIP cap enforced at assignment; recycle-after-N enforced in
 *  the disposition trigger; SLA hours drive the first-touch breach flag. */
function FloorControlsCard() {
  const qc = useQueryClient()
  const { data: cfg, isLoading } = useQuery({ queryKey: ['floor-config'], queryFn: floorConfigApi.get })
  const [wip, setWip] = useState('')
  const [sla, setSla] = useState('')
  const [recycle, setRecycle] = useState('')
  useEffect(() => { if (cfg) { setWip(String(cfg.wip_cap)); setSla(String(cfg.sla_hours)); setRecycle(String(cfg.recycle_attempts)) } }, [cfg])

  const save = useMutation({
    mutationFn: () => floorConfigApi.update({ wip_cap: Math.max(1, Number(wip) || 40), sla_hours: Math.max(1, Number(sla) || 4), recycle_attempts: Math.max(1, Number(recycle) || 5) }),
    onSuccess: () => { toast.success('Floor controls saved'); qc.invalidateQueries({ queryKey: ['floor-config'] }) },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  if (isLoading) return null

  return (
    <Card className="max-w-md p-5">
      <div className="mb-1 flex items-center gap-2">
        <SlidersHorizontal className="h-5 w-5 text-[var(--color-primary)]" />
        <h2 className="text-[16px] font-semibold">Floor controls</h2>
      </div>
      <p className="mb-4 text-sm text-[var(--color-text-secondary)]">Guardrails that keep the calling floor productive.</p>
      <div className="space-y-4">
        <div>
          <Label htmlFor="wip">WIP cap — max active leads per setter</Label>
          <Input id="wip" type="number" min={1} value={wip} onChange={(e) => setWip(e.target.value)} className="w-32" />
          <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">Assignment is blocked once a setter is holding this many unworked leads.</p>
        </div>
        <div>
          <Label htmlFor="sla">First-touch SLA — hours to first dial</Label>
          <Input id="sla" type="number" min={1} value={sla} onChange={(e) => setSla(e.target.value)} className="w-32" />
          <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">A newly-assigned lead flagged overdue if not dialled within this many hours.</p>
        </div>
        <div>
          <Label htmlFor="recycle">Recycle after — no-answer attempts</Label>
          <Input id="recycle" type="number" min={1} value={recycle} onChange={(e) => setRecycle(e.target.value)} className="w-32" />
          <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">After this many no-connects, the lead auto-parks (frees WIP; stays with the rep).</p>
        </div>
        <Button onClick={() => save.mutate()} loading={save.isPending}>Save floor controls</Button>
      </div>
    </Card>
  )
}
