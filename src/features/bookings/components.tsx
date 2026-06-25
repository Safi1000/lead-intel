import { useState } from 'react'
import { Check, Copy, MapPin, Phone, Video, Calendar, AlertTriangle, BadgeCheck, Mail } from 'lucide-react'
import { toast } from 'sonner'
import type { MatchConfidence, MeetingLocation } from '../../api/bookings'
import { Button } from '../../components/ui/primitives'
import { LOCATION_META } from './util'
import { cn } from '../../lib/utils'

/** Copy-to-clipboard affordance (matches the lead-detail pattern). */
export function CopyButton({ text, className, label }: { text: string; className?: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      aria-label={label ?? `Copy ${text}`}
      className={cn('inline-flex items-center gap-1 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-primary)]', className)}
      onClick={async (e) => {
        e.stopPropagation()
        e.preventDefault()
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        } catch {
          toast.error('Could not copy')
        }
      }}
    >
      {done ? <Check className="h-3.5 w-3.5 text-[var(--c-verified)]" /> : <Copy className="h-3.5 w-3.5" />}
      {label && <span className="text-[12px]">{done ? 'Copied' : label}</span>}
    </button>
  )
}

const LOCATION_ICONS: Record<string, typeof Video> = { Video, Phone, MapPin, Calendar }

/** Location of a meeting — icon + label + a Join button when joinable. */
export function LocationBadge({ location }: { location: MeetingLocation }) {
  const meta = LOCATION_META[location.kind]
  const LIcon = LOCATION_ICONS[meta.icon] ?? Calendar
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-secondary)]">
      <span className="inline-flex items-center gap-1.5">
        <LIcon className="h-4 w-4 text-[var(--color-text-muted)]" />
        {meta.label}
      </span>
      {location.detail && <span className="font-mono text-[12px] text-[var(--color-text-muted)]">{location.detail}</span>}
      {location.joinUrl && (
        <a href={location.joinUrl} target="_blank" rel="noreferrer">
          <Button size="sm" variant="outline">Join</Button>
        </a>
      )}
    </span>
  )
}

/** Match confidence — color is never the only signal; always icon + label. */
export function MatchBadge({ confidence }: { confidence: MatchConfidence }) {
  if (confidence === 'unmatched') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[12px] font-medium text-amber-700">
        <AlertTriangle className="h-3.5 w-3.5" /> No CRM lead matched
      </span>
    )
  }
  const isId = confidence === 'matched_by_id'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium',
        isId ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700',
      )}
    >
      {isId ? <BadgeCheck className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
      {isId ? 'Matched by Lead ID' : 'Matched by email'}
    </span>
  )
}
