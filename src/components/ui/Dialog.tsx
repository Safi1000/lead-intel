import * as React from 'react'
import * as RD from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from './primitives'

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm data-[state=open]:animate-in" />
        <RD.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[16px] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl focus:outline-none',
            className,
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <RD.Title className="text-[18px] font-semibold text-[var(--color-text)]">
                {title}
              </RD.Title>
              {description && (
                <RD.Description className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  {description}
                </RD.Description>
              )}
            </div>
            <RD.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </RD.Close>
          </div>
          {children}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  )
}

/** Typed-confirmation dialog for destructive actions (§16, §18-10). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel = 'Confirm',
  requireText,
  requireReason,
  loading,
  onConfirm,
  destructive,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  message: React.ReactNode
  confirmLabel?: string
  requireText?: string
  requireReason?: boolean
  loading?: boolean
  onConfirm: (reason?: string) => void
  destructive?: boolean
}) {
  const [text, setText] = React.useState('')
  const [reason, setReason] = React.useState('')
  React.useEffect(() => {
    if (!open) {
      setText('')
      setReason('')
    }
  }, [open])
  const textOk = !requireText || text === requireText
  const reasonOk = !requireReason || reason.trim().length > 3
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={message}>
      {requireText && (
        <div className="mb-3">
          <p className="mb-1.5 text-sm text-[var(--color-text-secondary)]">
            Type <span className="font-mono font-semibold">{requireText}</span> to confirm.
          </p>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="h-9 w-full rounded-[8px] border border-[var(--color-border)] px-3 text-sm focus:border-[var(--color-primary)] focus-visible:outline-none"
          />
        </div>
      )}
      {requireReason && (
        <div className="mb-3">
          <p className="mb-1.5 text-sm text-[var(--color-text-secondary)]">
            Reason (written to the audit log)
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="w-full rounded-[8px] border border-[var(--color-border)] px-3 py-2 text-sm focus:border-[var(--color-primary)] focus-visible:outline-none"
          />
        </div>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          variant={destructive ? 'danger' : 'primary'}
          loading={loading}
          disabled={!textOk || !reasonOk}
          onClick={() => onConfirm(requireReason ? reason : undefined)}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}
