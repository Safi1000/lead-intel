import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { settingsApi } from '../../api/endpoints'
import { Button, Card } from '../../components/ui/primitives'
import { Switch } from '../../components/ui/controls'
import { LoadingState } from '../../components/feedback'
import type { NotificationPrefs } from '../../api/types'

const EVENTS: { key: keyof NotificationPrefs; label: string; desc: string }[] = [
  { key: 'batch_ready', label: 'Batch ready', desc: 'A delivery batch finished enriching.' },
  { key: 'hot_lead', label: 'Hot lead alert', desc: 'A high-confidence, contactable lead was found.' },
  { key: 'run_failed', label: 'Run failed', desc: 'A run failed and needs attention.' },
  { key: 'weekly_summary', label: 'Weekly summary', desc: 'A digest of activity each week.' },
]

export function NotificationsSettingsPage() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['notif-prefs'], queryFn: settingsApi.getNotifications })
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null)
  useEffect(() => { if (data) setPrefs(data) }, [data])

  const save = useMutation({
    mutationFn: (p: NotificationPrefs) => settingsApi.updateNotifications(p),
    onSuccess: () => { toast.success('Preferences saved'); qc.invalidateQueries({ queryKey: ['notif-prefs'] }) },
    onError: () => toast.error('Couldn’t save'),
  })

  if (isLoading || !prefs) return <LoadingState />

  function set(key: keyof NotificationPrefs, channel: 'email' | 'whatsapp', value: boolean) {
    setPrefs((p) => (p ? { ...p, [key]: { ...p[key], [channel]: value } } : p))
  }

  return (
    <div className="max-w-2xl">
      <Card>
        <div className="border-b border-[var(--color-border)] px-6 py-4">
          <h2 className="text-[16px] font-semibold">Notification preferences</h2>
          <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">Choose how you’re notified per event.</p>
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 px-6 py-3 text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
          <span>Event</span>
          <span className="w-16 text-center">Email</span>
          <span className="w-20 text-center">WhatsApp</span>
        </div>
        <ul className="divide-y divide-[var(--color-border)]">
          {EVENTS.map((e) => (
            <li key={e.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 px-6 py-4">
              <div>
                <p className="text-sm font-medium">{e.label}</p>
                <p className="text-[13px] text-[var(--color-text-secondary)]">{e.desc}</p>
              </div>
              <span className="flex w-16 justify-center"><Switch checked={prefs[e.key].email} onCheckedChange={(v) => set(e.key, 'email', v)} /></span>
              <span className="flex w-20 flex-col items-center gap-0.5">
                <Switch checked={prefs[e.key].whatsapp} onCheckedChange={(v) => set(e.key, 'whatsapp', v)} disabled />
                <span className="text-[10px] uppercase text-[var(--color-text-muted)]">Soon</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] px-6 py-4">
          <p className="text-[13px] text-[var(--color-text-muted)]">Connect WhatsApp to enable that channel (Phase 2).</p>
          <Button loading={save.isPending} onClick={() => save.mutate(prefs)}>Save preferences</Button>
        </div>
      </Card>
    </div>
  )
}
