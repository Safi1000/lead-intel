import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'

/** Right-side slide-over. Used for the list-and-drawer lead pattern (spec §10). */
export function Sheet({ open, onClose, title, children, width = 'max-w-lg' }: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  width?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <div className={cn('fixed inset-0 z-50', open ? 'pointer-events-auto' : 'pointer-events-none')} aria-hidden={!open}>
      <div className={cn('absolute inset-0 bg-black/30 transition-opacity duration-200', open ? 'opacity-100' : 'opacity-0')} onClick={onClose} />
      <div className={cn('absolute right-0 top-0 flex h-full w-full flex-col bg-[var(--color-surface)] shadow-xl transition-transform duration-200', width, open ? 'translate-x-0' : 'translate-x-full')}
        role="dialog" aria-modal="true">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
          <div className="min-w-0 text-[15px] font-semibold">{title}</div>
          <button onClick={onClose} className="rounded-full p-1 text-[var(--color-text-muted)] hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}
