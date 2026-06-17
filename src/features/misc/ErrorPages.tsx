import { Link, useRouteError, isRouteErrorResponse } from 'react-router-dom'
import { Ban, Construction, FileQuestion, ServerCrash } from 'lucide-react'
import { Button } from '../../components/ui/primitives'

function Shell({
  icon: Icon,
  code,
  title,
  message,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  code: string
  title: string
  message: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[var(--color-bg)] px-6 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
        <Icon className="h-8 w-8 text-[var(--color-text-secondary)]" />
      </div>
      <p className="text-[13px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">{code}</p>
      <h1 className="mt-1 text-[28px] font-bold text-[var(--color-text)]">{title}</h1>
      <p className="mt-2 max-w-md text-sm text-[var(--color-text-secondary)]">{message}</p>
      <div className="mt-6 flex gap-3">{children}</div>
    </div>
  )
}

export function NotFoundPage() {
  return (
    <Shell icon={FileQuestion} code="404" title="Page not found" message="The page you’re looking for doesn’t exist or was moved.">
      <Link to="/home"><Button>Back to dashboard</Button></Link>
    </Shell>
  )
}

export function ForbiddenPage() {
  return (
    <Shell icon={Ban} code="403" title="Access denied" message="Your role doesn’t have permission to view this. Contact an account admin or switch accounts.">
      <Link to="/home"><Button variant="outline">Back to dashboard</Button></Link>
    </Shell>
  )
}

export function MaintenancePage() {
  return (
    <Shell icon={Construction} code="503" title="Down for maintenance" message="We’re performing scheduled maintenance and will be back shortly.">
      <a href="."><Button variant="outline">Retry</Button></a>
    </Shell>
  )
}

/** Top-level route error boundary → friendly /500 fallback (§18-6). */
export function RouteErrorBoundary() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'An unexpected error occurred.'
  return (
    <Shell icon={ServerCrash} code="500" title="Something broke" message={message}>
      <Button onClick={() => location.assign('/home')}>Reload</Button>
      <a href="mailto:support@techexcel.io"><Button variant="outline">Report</Button></a>
    </Shell>
  )
}
