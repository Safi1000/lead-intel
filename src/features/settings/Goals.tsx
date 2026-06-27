import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Target } from 'lucide-react'
import { progressApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { Button, Card, Input, Label } from '../../components/ui/primitives'
import { LoadingState } from '../../components/feedback'

/** Manager/SA set the org-wide daily lead goal (leads each setter should
 *  mark as done per day). Drives the Progress page targets. */
export function GoalsSettingsPage() {
  const qc = useQueryClient()
  const { data: goal, isLoading } = useQuery({ queryKey: ['daily-goal'], queryFn: progressApi.getGoal })
  const [value, setValue] = useState('')
  useEffect(() => { if (goal != null) setValue(String(goal)) }, [goal])

  const save = useMutation({
    mutationFn: () => progressApi.setGoal(Number(value) || 0),
    onSuccess: () => {
      toast.success('Daily goal saved')
      qc.invalidateQueries({ queryKey: ['daily-goal'] })
      qc.invalidateQueries({ queryKey: ['my-progress'] })
      qc.invalidateQueries({ queryKey: ['setter-progress'] })
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  if (isLoading) return <LoadingState />

  return (
    <Card className="max-w-md p-5">
      <div className="mb-1 flex items-center gap-2">
        <Target className="h-5 w-5 text-[var(--color-primary)]" />
        <h2 className="text-[16px] font-semibold">Daily lead goal</h2>
      </div>
      <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
        How many leads each setter should mark as <span className="font-medium">done</span> per day. Used to track
        daily / weekly / monthly progress on the Progress page. Weekly target = goal × 7, monthly target = goal × days in the month.
      </p>
      <Label htmlFor="goal">Leads per setter per day</Label>
      <div className="flex items-center gap-2">
        <Input id="goal" type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} className="w-32" />
        <Button onClick={() => save.mutate()} loading={save.isPending}>Save</Button>
      </div>
      <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">Set to 0 to disable goal tracking.</p>
    </Card>
  )
}
