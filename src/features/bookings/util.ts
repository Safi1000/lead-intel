/** Time + location formatting for the Bookings module. Calendly times are UTC;
 *  everything here renders in the AE's local timezone. */
import type { MeetingLocation } from '../../api/bookings'

/** YYYY-MM-DD for an instant, evaluated in the given timezone. */
function tzDateKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

/** "Today" / "Tomorrow" / "Mon, Jun 30" — grouping header, in the AE's tz. */
export function dayGroupLabel(iso: string, tz: string): string {
  const key = tzDateKey(iso, tz)
  const todayKey = tzDateKey(new Date().toISOString(), tz)
  const tomorrowKey = tzDateKey(new Date(Date.now() + 86_400_000).toISOString(), tz)
  if (key === todayKey) return 'Today'
  if (key === tomorrowKey) return 'Tomorrow'
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso))
}

function tzAbbrev(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(iso))
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
}

function fmtTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

/** "2:30 – 3:00 PM CDT" in the AE's tz. */
export function fmtRange(startIso: string, endIso: string, tz: string): string {
  const zone = tzAbbrev(startIso, tz)
  return `${fmtTime(startIso, tz)} – ${fmtTime(endIso, tz)}${zone ? ` ${zone}` : ''}`
}

/** "in 35m" / "in 2h" / "in 3d" / "Starting now". */
export function relativeHint(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return 'Starting now'
  const mins = Math.round(diff / 60_000)
  if (mins < 60) return `in ${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `in ${hours}h`
  return `in ${Math.round(hours / 24)}d`
}

export const LOCATION_META: Record<MeetingLocation['kind'], { label: string; icon: string }> = {
  zoom: { label: 'Zoom', icon: 'Video' },
  google_meet: { label: 'Google Meet', icon: 'Video' },
  ms_teams: { label: 'Microsoft Teams', icon: 'Video' },
  phone: { label: 'Phone call', icon: 'Phone' },
  in_person: { label: 'In person', icon: 'MapPin' },
  other: { label: 'Other', icon: 'Calendar' },
}
