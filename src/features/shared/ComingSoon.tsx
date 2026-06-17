import { Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/primitives'

/** Phase-2/3 placeholder so feature-flagged routes never dead-end (§18-7). */
export function ComingSoon({
  title,
  phase = 'Phase 2',
  description,
}: {
  title: string
  phase?: string
  description?: string
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50">
        <Sparkles className="h-7 w-7 text-[var(--color-primary)]" />
      </div>
      <span className="mb-2 rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
        {phase}
      </span>
      <h1 className="text-[24px] font-bold text-[var(--color-text)]">{title}</h1>
      <p className="mt-2 max-w-md text-sm text-[var(--color-text-secondary)]">
        {description ??
          'This area is on the roadmap. The route and layout are reserved — functionality lights up when the backend is ready.'}
      </p>
      <Link to="/home" className="mt-6">
        <Button variant="outline">Back to dashboard</Button>
      </Link>
    </div>
  )
}
