import { useState, type ComponentProps } from 'react'
import { Cloud, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/primitives'
import { trackEvent } from '../../lib/analytics'
import type { CrmProvider, CrmPushResult } from '../../api/endpoints'

export const CRM_LABEL: Record<CrmProvider, string> = {
  hubspot: 'HubSpot', gohighlevel: 'GoHighLevel', pipedrive: 'Pipedrive',
  zoho: 'Zoho CRM', salesforce: 'Salesforce', webhook: 'Webhook',
}

/** One toast summarising a push, naming the CRM(s) it went to. */
export function crmResultToast(results: CrmPushResult[], targets: CrmProvider[]) {
  const to = targets.map((p) => CRM_LABEL[p]).join(' & ')
  const synced = results.filter((r) => r.status === 'synced').length
  const dup = results.filter((r) => r.status === 'duplicate').length
  const skipped = results.filter((r) => r.status === 'skipped').length
  const failed = results.filter((r) => r.status === 'failed')
  // Every CRM push funnels through this toast, so it's the one place to measure them.
  trackEvent('crm_push', {
    crm: targets.join(','),
    synced, duplicate: dup, skipped, failed: failed.length,
  })
  if (failed.length && !synced && !dup) { toast.error(failed[0].error ?? `Couldn’t send to ${to}`); return }
  const bits = [synced && `${synced} sent`, dup && `${dup} already there`, skipped && `${skipped} already sent`, failed.length && `${failed.length} failed`].filter(Boolean).join(', ')
  if (failed.length) toast.error(`Sent to ${to} — ${bits}`)
  else toast.success(`Sent to ${to}${bits ? ` — ${bits}` : ''}`)
}

/**
 * "Send to CRM" button. If exactly one CRM is connected it sends straight there; if several are
 * connected it opens a menu to pick one (or all). Hidden entirely when nothing is connected.
 */
export function SendToCrmMenu({ connected, onSend, pending, disabled, size = 'sm', variant = 'outline', label = 'Send to CRM' }: {
  connected: CrmProvider[]
  onSend: (providers: CrmProvider[]) => void
  pending?: boolean
  disabled?: boolean
  size?: ComponentProps<typeof Button>['size']
  variant?: ComponentProps<typeof Button>['variant']
  label?: string
}) {
  const [open, setOpen] = useState(false)
  if (!connected.length) return null

  if (connected.length === 1) {
    return <Button variant={variant} size={size} loading={pending} disabled={disabled} onClick={() => onSend(connected)}><Cloud className="h-4 w-4" /> {label}</Button>
  }

  return (
    <div className="relative">
      <Button variant={variant} size={size} loading={pending} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        <Cloud className="h-4 w-4" /> {label} <ChevronDown className="h-3.5 w-3.5" />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 min-w-[210px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-lg">
            <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Send to…</p>
            {connected.map((p) => (
              <button key={p} type="button" onClick={() => { setOpen(false); onSend([p]) }}
                className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-sm hover:bg-[var(--color-surface-2)]">
                <Cloud className="h-4 w-4 text-[var(--color-primary)]" /> {CRM_LABEL[p]}
              </button>
            ))}
            <button type="button" onClick={() => { setOpen(false); onSend(connected) }}
              className="mt-1 flex w-full items-center gap-2 rounded-[6px] border-t border-[var(--color-border)] px-2 py-1.5 text-left text-sm hover:bg-[var(--color-surface-2)]">
              <Cloud className="h-4 w-4" /> All connected
            </button>
          </div>
        </>
      )}
    </div>
  )
}
