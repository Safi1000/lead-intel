import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Input, Label } from '../../components/ui/primitives'
import { PageHeader } from '../shared/bits'

// Rough model from the cost audit: metros saturate, so the qualify rate drifts — this is a guide.
const QUAL_RATE = 0.15
const COST_PER_QUALIFIED = 0.02

function Row({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--color-text-secondary)]">{label}{note && <span className="ml-1 text-[12px] text-[var(--color-text-muted)]">· {note}</span>}</span>
      <span className={strong ? 'tabular-nums font-semibold text-[var(--color-primary)]' : 'tabular-nums font-medium'}>{value}</span>
    </div>
  )
}

/** §10/§13 lead discovery — pre-pull cost preview. Niche/metros are fixed in the engine, so this is
 *  a cost estimator + jumping-off point rather than a full search builder. */
export function DiscoveryPage() {
  const [target, setTarget] = useState('200')
  const n = Math.max(0, Number(target) || 0)
  const scanned = Math.round(n / QUAL_RATE)
  const cost = n * COST_PER_QUALIFIED
  return (
    <div className="reveal max-w-lg">
      <PageHeader title="Lead discovery" subtitle="Estimate what a pull costs before you run it." />
      <Card className="space-y-4 p-5">
        <div>
          <Label htmlFor="target">Target qualified leads</Label>
          <Input id="target" type="number" min={0} value={target} onChange={(e) => setTarget(e.target.value)} className="max-w-[160px]" />
        </div>
        <div className="space-y-2 rounded-[10px] bg-[var(--color-surface-2)] p-4 text-sm">
          <Row label="Places scanned" value={`~${scanned.toLocaleString()}`} note={`~${Math.round(QUAL_RATE * 100)}% qualify`} />
          <Row label="Estimated API cost" value={`~$${cost.toFixed(2)}`} note={`~$${COST_PER_QUALIFIED.toFixed(2)}/qualified`} strong />
        </div>
        <p className="text-[12px] text-[var(--color-text-muted)]">
          Niche and target metros are fixed in the engine (med spas · Canadian metros). The qualify rate falls as metros
          saturate, so treat this as a guide, not a quote. Start a run from the <Link to="/pipeline" className="text-[var(--color-primary)] hover:underline">Pipeline</Link> page.
        </p>
      </Card>
    </div>
  )
}
