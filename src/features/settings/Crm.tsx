import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Cloud, Database, Link2, Unlink } from 'lucide-react'
import { crmApi, type CrmProvider, type CrmConnection } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { useAuthStore } from '../../stores/authStore'
import { Button, Card } from '../../components/ui/primitives'
import { Switch } from '../../components/ui/controls'
import { LoadingState, ErrorState } from '../../components/feedback'

const PROVIDERS: Array<{ key: CrmProvider; name: string; icon: React.ReactNode; blurb: string }> = [
  { key: 'hubspot', name: 'HubSpot', icon: <Database className="h-5 w-5 text-[var(--color-primary)]" />, blurb: 'Push leads into HubSpot as contacts.' },
  { key: 'gohighlevel', name: 'GoHighLevel', icon: <Cloud className="h-5 w-5 text-[var(--color-primary)]" />, blurb: 'Send leads into a GoHighLevel location.' },
]

export function CrmSettingsPage() {
  const qc = useQueryClient()
  const orgId = useAuthStore((s) => s.actingOrgId)
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['crm-status', orgId], queryFn: () => crmApi.status(orgId) })

  // The connect popup posts back "crm-connected" when it finishes.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => { if (e.data === 'crm-connected') refetch() }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [refetch])

  if (isLoading) return <LoadingState label="Loading CRM connections…" />
  if (isError) return <ErrorState message="We couldn’t load your CRM connections." onRetry={() => refetch()} />

  return (
    <div className="reveal max-w-2xl space-y-4">
      <p className="text-sm text-[var(--color-text-secondary)]">
        Connect the CRM your team already uses. Once connected, you can push leads over from a lead, a whole batch, or the Cold Leads page — or turn on auto-sync to send them automatically.
      </p>
      {PROVIDERS.map((p) => (
        <ProviderCard
          key={p.key}
          def={p}
          conn={data?.[p.key] ?? null}
          configured={!!data?.configured?.[p.key]}
          orgId={orgId}
          onChange={() => qc.invalidateQueries({ queryKey: ['crm-status', orgId] })}
        />
      ))}
    </div>
  )
}

function ProviderCard({ def, conn, configured, orgId, onChange }: {
  def: { key: CrmProvider; name: string; icon: React.ReactNode; blurb: string }
  conn: CrmConnection | null
  configured: boolean
  orgId: string | null
  onChange: () => void
}) {
  const connected = !!conn?.connected

  const connect = async () => {
    try {
      const { url } = await crmApi.startUrl(def.key, orgId)
      const popup = window.open(url, 'crm-oauth', 'width=620,height=760')
      // HubSpot's OAuth pages set COOP, which stops the popup from messaging back or closing itself.
      // So poll status from here; once connected, close the popup ourselves and refresh.
      const startedAt = Date.now()
      const timer = window.setInterval(async () => {
        let done = false
        try {
          const s = await crmApi.status(orgId)
          if (s[def.key]?.connected) { done = true; toast.success(`${def.name} connected`); onChange() }
        } catch { /* keep polling */ }
        if (done || (popup && popup.closed) || Date.now() - startedAt > 180_000) {
          window.clearInterval(timer)
          try { popup?.close() } catch { /* ignore */ }
        }
      }, 2500)
    } catch (e) { toast.error(normalizeError(e).message) }
  }
  const disconnect = useMutation({
    mutationFn: () => crmApi.disconnect(def.key, orgId),
    onSuccess: () => { toast.success(`${def.name} disconnected`); onChange() },
    onError: (e) => toast.error(normalizeError(e).message),
  })
  const setToggle = useMutation({
    mutationFn: (s: { autoQualified?: boolean; autoCold?: boolean }) => crmApi.settings(def.key, s, orgId),
    onSuccess: () => onChange(),
    onError: (e) => toast.error(normalizeError(e).message),
  })

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-[10px] bg-[var(--color-surface-2)] p-2">{def.icon}</div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-semibold">{def.name}</h3>
              {connected && <span className="rounded-full bg-[var(--c-verified-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--c-verified-text)]">Connected</span>}
            </div>
            <p className="mt-0.5 text-[13px] text-[var(--color-text-secondary)]">
              {connected ? `Connected${conn?.account ? ` — ${conn.account}` : ''}` : def.blurb}
            </p>
          </div>
        </div>
        {connected ? (
          <Button variant="outline" size="sm" loading={disconnect.isPending} onClick={() => disconnect.mutate()}><Unlink className="h-4 w-4" /> Disconnect</Button>
        ) : (
          <Button size="sm" onClick={connect} disabled={!configured} title={configured ? '' : `${def.name} isn’t set up on the server yet`}><Link2 className="h-4 w-4" /> Connect</Button>
        )}
      </div>

      {!connected && !configured && (
        <p className="mt-3 rounded-[8px] bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-400">
          {def.name} isn’t configured on the server yet — add its API credentials to enable connecting.
        </p>
      )}

      {connected && (
        <div className="mt-4 space-y-3 border-t border-[var(--color-border)] pt-4">
          <ToggleRow
            label="Auto-sync every new qualified lead"
            hint="New qualified leads are pushed to this CRM automatically."
            checked={!!conn?.autoQualified}
            disabled={setToggle.isPending}
            onChange={(v) => setToggle.mutate({ autoQualified: v })}
          />
          <ToggleRow
            label="Also sync cold leads"
            hint="Include the scanned-but-not-qualified pool in auto-sync."
            checked={!!conn?.autoCold}
            disabled={setToggle.isPending}
            onChange={(v) => setToggle.mutate({ autoCold: v })}
          />
        </div>
      )}
    </Card>
  )
}

function ToggleRow({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[12px] text-[var(--color-text-muted)]">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  )
}
