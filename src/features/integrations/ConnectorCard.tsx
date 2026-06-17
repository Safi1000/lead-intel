import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Link2, Loader2, Settings2, Unplug } from 'lucide-react'
import { integrationsApi } from '../../api/endpoints'
import { Button, Card } from '../../components/ui/primitives'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { relativeTime } from '../../lib/time'
import type { Integration } from '../../api/types'

/** Reusable OAuth connector card (§I-3). Handles connect/configure/disconnect. */
export function ConnectorCard({
  provider,
  name,
  description,
  icon,
  state,
  onConfigure,
}: {
  provider: string
  name: string
  description: string
  icon: React.ReactNode
  state?: Integration
  onConfigure?: () => void
}) {
  const qc = useQueryClient()
  const [disc, setDisc] = useState(false)

  const connect = useMutation({
    mutationFn: () => integrationsApi.connect(provider),
    onSuccess: () => {
      toast.success(`${name} connected`)
      qc.invalidateQueries({ queryKey: ['integrations'] })
    },
    onError: () => toast.error('Connection failed — popup blocked or cancelled. Try again.'),
  })
  const disconnect = useMutation({
    mutationFn: () => integrationsApi.disconnect(provider),
    onSuccess: () => {
      toast.success(`${name} disconnected`)
      qc.invalidateQueries({ queryKey: ['integrations'] })
      setDisc(false)
    },
  })

  const connected = state?.status === 'connected'
  const expired = state?.status === 'expired'

  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-surface-2)]">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-semibold">{name}</h3>
            {connected && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--c-verified-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--c-verified-text)]">
                <Check className="h-3 w-3" /> Connected
              </span>
            )}
            {expired && <span className="rounded-full bg-[var(--c-unverified-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--c-unverified-text)]">Expired</span>}
          </div>
          <p className="mt-0.5 text-[13px] text-[var(--color-text-secondary)]">{description}</p>
          {connected && state?.account_name && (
            <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">{state.account_name} · connected {relativeTime(state.connected_at)}</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        {connected ? (
          <>
            {onConfigure && (
              <Button size="sm" variant="outline" onClick={onConfigure}>
                <Settings2 className="h-3.5 w-3.5" /> Configure
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setDisc(true)}>
              <Unplug className="h-3.5 w-3.5" /> Disconnect
            </Button>
          </>
        ) : (
          <Button size="sm" loading={connect.isPending} onClick={() => connect.mutate()}>
            {connect.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            {expired ? 'Reconnect' : 'Connect'}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={disc}
        onOpenChange={setDisc}
        title={`Disconnect ${name}?`}
        message="New syncs will stop. Data already pushed to this integration is unaffected."
        confirmLabel="Disconnect"
        destructive
        loading={disconnect.isPending}
        onConfirm={() => disconnect.mutate()}
      />
    </Card>
  )
}
