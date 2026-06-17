import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { Bell, CheckCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { notificationsApi } from '../../api/endpoints'
import { relativeTime } from '../../lib/time'
import { cn } from '../../lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui/controls'

export function NotificationBell() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: notificationsApi.list })
  const markRead = useMutation({
    mutationFn: notificationsApi.markRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const items = data?.data ?? []
  const unread = items.filter((n) => !n.read).length

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="relative rounded-full p-2 text-[var(--color-text-secondary)] hover:bg-slate-100"
          aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--c-unverified)] px-1 text-[10px] font-semibold text-white">
              {unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && <span className="text-[12px] text-[var(--color-text-muted)]">{unread} new</span>}
        </div>
        <div className="max-h-80 overflow-auto">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
              You’re all caught up.
            </p>
          ) : (
            items.map((n) => (
              <Link
                key={n.id}
                to={n.link ?? '#'}
                onClick={() => !n.read && markRead.mutate(n.id)}
                className={cn(
                  'flex gap-3 border-b border-[var(--color-border)] px-4 py-3 last:border-0 hover:bg-slate-50',
                  !n.read && 'bg-blue-50/40',
                )}
              >
                <span
                  className={cn(
                    'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                    n.read ? 'bg-transparent' : 'bg-[var(--color-primary)]',
                  )}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--color-text)]">{n.title}</p>
                  <p className="text-[13px] text-[var(--color-text-secondary)]">{n.body}</p>
                  <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">{relativeTime(n.created_at)}</p>
                </div>
              </Link>
            ))
          )}
        </div>
        {items.length > 0 && (
          <button
            onClick={() => items.filter((n) => !n.read).forEach((n) => markRead.mutate(n.id))}
            className="flex w-full items-center justify-center gap-1.5 border-t border-[var(--color-border)] py-2.5 text-[13px] font-medium text-[var(--color-primary)] hover:bg-slate-50"
          >
            <CheckCheck className="h-4 w-4" /> Mark all read
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
