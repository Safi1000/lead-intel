import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import { ArrowLeft, CalendarClock, Check, Copy, ExternalLink, MessageCircle, Phone, PhoneCall, Send } from 'lucide-react'
import { activitiesApi, manualLeadsApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { ROLE_LABELS } from '../../config/permissions'
import { useAuth } from '../../hooks'
import { Button, Card, Input, Label, Textarea } from '../../components/ui/primitives'
import { Dialog } from '../../components/ui/Dialog'
import { ErrorState, LoadingState } from '../../components/feedback'
import { toast } from 'sonner'
import { cn } from '../../lib/utils'
import { StageSelect, FollowUpCell } from './controls'
import { canWorkLeads, isOverdue } from './workflow'
import { ACTIVITY_TYPES, type ActivityType, type LeadStage, type ManualLead } from '../../api/types'

const digits = (s: string) => s.replace(/[^\d]/g, '')
const looksEmail = (s: string) => /^\S+@\S+\.\S+$/.test(s.trim())
const looksPhone = (s: string) => digits(s).length >= 7 && /^[\d\s+().-]+$/.test(s.trim())
const looksUrl = (s: string) => {
  const v = s.trim()
  if (v.includes('@') || v.includes(' ')) return false
  return /^(https?:\/\/|www\.)/i.test(v) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v)
}
const hrefFor = (s: string) => (/^https?:\/\//i.test(s.trim()) ? s.trim() : `https://${s.trim().replace(/^\/+/, '')}`)
/** Find a lead data value whose column name matches a pattern (Feature 4 call card). */
const findField = (data: Record<string, string>, re: RegExp) => {
  const hit = Object.entries(data).find(([k, v]) => re.test(k) && v?.trim())
  return hit?.[1]?.trim() ?? null
}

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" title="Copy" aria-label="Copy"
      onClick={async (e) => { e.stopPropagation(); e.preventDefault(); try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200) } catch { toast.error('Could not copy') } }}
      className={cn('shrink-0 rounded p-1 text-[var(--color-text-muted)] transition hover:bg-slate-100 hover:text-[var(--color-text)]', className)}>
      {done ? <Check className="h-3.5 w-3.5 text-[var(--c-verified)]" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

function LeadValue({ value }: { value: string }) {
  const v = value.trim()
  if (!v) return <span className="text-[var(--color-text-muted)]">—</span>
  if (looksEmail(v)) return <a href={`mailto:${v}`} className="break-all text-[var(--color-primary)] hover:underline">{value}</a>
  if (looksUrl(v)) return <a href={hrefFor(v)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-[var(--color-primary)] hover:underline">{value}<ExternalLink className="h-3 w-3 shrink-0" /></a>
  return <span className="break-words">{value}</span>
}

const toLocalInput = (iso: string | null) => (iso ? format(new Date(iso), "yyyy-MM-dd'T'HH:mm") : '')

export function ManualLeadDetailPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { role, user } = useAuth()
  const me = user?.name ?? ''
  const canWork = canWorkLeads(role)

  const { data: lead, isLoading, isError, refetch } = useQuery({ queryKey: ['manual-lead', id], queryFn: () => manualLeadsApi.get(id as string), enabled: !!id })
  const { data: activities } = useQuery({ queryKey: ['activities', id], queryFn: () => activitiesApi.list(id as string), enabled: !!id })

  const [remark, setRemark] = useState('')
  const [logType, setLogType] = useState<ActivityType | null>(null)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['manual-lead', id] })
    qc.invalidateQueries({ queryKey: ['activities', id] })
    qc.invalidateQueries({ queryKey: ['manual-leads'] })
    qc.invalidateQueries({ queryKey: ['lead-batches'] })
    qc.invalidateQueries({ queryKey: ['due-today'] })
    qc.invalidateQueries({ queryKey: ['org-user-stats'] })
  }

  const update = useMutation({
    mutationFn: (body: Parameters<typeof manualLeadsApi.update>[1]) => manualLeadsApi.update(id as string, body),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(normalizeError(e).message),
  })
  const addRemark = useMutation({
    mutationFn: () => manualLeadsApi.addRemark(id as string, { text: remark, author: me, author_role: role! }),
    onSuccess: () => { setRemark(''); toast.success('Remark added'); invalidate() },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  if (isLoading) return <LoadingState />
  if (isError || !lead) return <ErrorState onRetry={() => refetch()} />

  const backTo = lead.batch_id ? `/leads/batch/${lead.batch_id}` : '/leads'
  const acts = activities ?? []

  return (
    <div className="reveal mx-auto max-w-4xl">
      <Link to={backTo} className="mb-4 inline-flex items-center gap-1 text-[13px] text-[var(--color-primary)] hover:underline"><ArrowLeft className="h-4 w-4" /> Back to batch</Link>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="group min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="truncate text-[24px] font-bold tracking-tight">{lead.display_name}</h1>
            <CopyButton text={lead.display_name} />
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">From template “{lead.template_name}”</p>
        </div>
        <StageSelect stage={lead.stage} role={role} disabled={!canWork} onChange={(s) => update.mutate({ stage: s })} />
      </div>

      {lead.stage === 'Booked' && <CallCard lead={lead} />}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* Lead data */}
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Lead details</h2>
              <button type="button" onClick={async () => { const all = Object.entries(lead.data).map(([k, v]) => `${k}: ${v}`).join('\n'); try { await navigator.clipboard.writeText(all); toast.success('All fields copied') } catch { toast.error('Could not copy') } }}
                className="inline-flex items-center gap-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><Copy className="h-3.5 w-3.5" /> Copy all</button>
            </div>
            <dl className="divide-y divide-[var(--color-border)]">
              {Object.entries(lead.data).map(([key, value]) => (
                <div key={key} className="group flex items-start justify-between gap-4 py-2.5">
                  <dt className="pt-0.5 font-mono text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">{key}</dt>
                  <dd className="flex max-w-[68%] items-start gap-1.5 text-right text-sm">
                    <span className="text-left"><LeadValue value={value} /></span>
                    {value && looksPhone(value) && (
                      <>
                        <a href={`tel:${digits(value)}`} title="Call" className="shrink-0 rounded p-1 text-[var(--color-primary)] hover:bg-slate-100"><Phone className="h-4 w-4" /></a>
                        <a href={`https://wa.me/${digits(value)}`} target="_blank" rel="noreferrer" title="WhatsApp" className="shrink-0 rounded p-1 text-green-600 hover:bg-slate-100"><MessageCircle className="h-4 w-4" /></a>
                      </>
                    )}
                    {value && <CopyButton text={value} />}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>

          {/* Activity log */}
          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Activity log {acts.length > 0 && <span className="text-[var(--color-text-muted)]">({acts.length})</span>}</h2>
            {canWork && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {ACTIVITY_TYPES.map((t) => (
                  <button key={t} onClick={() => setLogType(t)} className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]">{t}</button>
                ))}
              </div>
            )}
            {acts.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">No activity logged yet. Use the buttons above to record each touch.</p>
            ) : (
              <ul className="space-y-2.5">
                {acts.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 border-l-2 border-[var(--color-primary)] pl-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-[13px]">
                        <span className="font-semibold">{a.type}</span>
                        {a.author && <span className="text-[var(--color-text-muted)]">· {a.author}</span>}
                        <span className="text-[var(--color-text-muted)]">· {formatDistanceToNow(new Date(a.at), { addSuffix: true })}</span>
                      </div>
                      {a.note && <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-[var(--color-text-secondary)]">{a.note}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Remarks (freeform, separate from the structured log) */}
          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Notes {lead.remarks.length > 0 && <span className="text-[var(--color-text-muted)]">({lead.remarks.length})</span>}</h2>
            {lead.remarks.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">No notes yet.</p>
            ) : (
              <ul className="space-y-3">
                {lead.remarks.map((r) => (
                  <li key={r.id} className="group rounded-[10px] bg-[var(--color-surface-2)] p-3">
                    <div className="mb-1 flex items-center gap-2 text-[12px]">
                      <span className="font-semibold text-[var(--color-text)]">{r.author}</span>
                      <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-600">{ROLE_LABELS[r.author_role]}</span>
                      <span className="text-[var(--color-text-muted)]">{formatDistanceToNow(new Date(r.at), { addSuffix: true })}</span>
                      <CopyButton text={r.text} className="ml-auto" />
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{r.text}</p>
                  </li>
                ))}
              </ul>
            )}
            {canWork && (
              <div className="mt-4">
                <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} rows={3} placeholder="Add a freeform note…" />
                <div className="mt-2 flex justify-end"><Button size="sm" loading={addRemark.isPending} disabled={!remark.trim()} onClick={() => addRemark.mutate()}><Send className="h-3.5 w-3.5" /> Add note</Button></div>
              </div>
            )}
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Status</h2>
            <div className="space-y-3">
              <div>
                <Label className="mb-1.5">Stage</Label>
                <StageSelect stage={lead.stage} role={role} disabled={!canWork} onChange={(s) => update.mutate({ stage: s })} />
              </div>
              <div>
                <Label className="mb-1.5 flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Next follow-up</Label>
                <FollowUpCell value={lead.next_follow_up} disabled={!canWork} onChange={(d) => update.mutate({ next_follow_up: d })} />
                {isOverdue(lead.next_follow_up) && <p className="mt-1 text-[12px] font-medium text-red-600">Overdue</p>}
              </div>
              {(lead.stage === 'Booked' || lead.call_at) && (
                <div>
                  <Label htmlFor="call-at" className="mb-1.5 flex items-center gap-1"><PhoneCall className="h-3.5 w-3.5" /> Call date &amp; time</Label>
                  {canWork ? (
                    <Input id="call-at" type="datetime-local" value={toLocalInput(lead.call_at)} onChange={(e) => update.mutate({ call_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                  ) : (
                    <p className="text-sm">{lead.call_at ? format(new Date(lead.call_at), 'PPp') : '—'}</p>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* Closer outcome shortcuts */}
          {role === 'closer' && (
            <Card className="p-5">
              <h2 className="mb-3 text-[15px] font-semibold">Call outcome</h2>
              <div className="grid grid-cols-3 gap-2">
                {(['Won', 'Lost', 'Not Now'] as LeadStage[]).map((s) => (
                  <Button key={s} size="sm" variant={lead.stage === s ? 'primary' : 'outline'} loading={update.isPending && update.variables?.stage === s} onClick={() => update.mutate({ stage: s })}>{s}</Button>
                ))}
              </div>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Assignment</h2>
            <dl className="space-y-2 text-sm">
              <div className="group flex items-center justify-between gap-2"><dt className="text-[var(--color-text-muted)]">Setter</dt><dd className="flex items-center gap-1">{lead.setter ?? '—'}{lead.setter && <CopyButton text={lead.setter} />}</dd></div>
              <div className="group flex items-center justify-between gap-2"><dt className="text-[var(--color-text-muted)]">Closer</dt><dd className="flex items-center gap-1">{lead.closer ?? '—'}{lead.closer && <CopyButton text={lead.closer} />}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Updated</dt><dd>{formatDistanceToNow(new Date(lead.updated_at), { addSuffix: true })}</dd></div>
            </dl>
          </Card>
        </div>
      </div>

      {logType && (
        <LogActivityDialog
          type={logType}
          onClose={() => setLogType(null)}
          onDone={() => { setLogType(null); invalidate() }}
          leadId={id as string}
          currentCallAt={lead.call_at}
        />
      )}
    </div>
  )
}

/** Feature 4 — clean call card surfaced when a lead is Booked. */
function CallCard({ lead }: { lead: ManualLead }) {
  const website = findField(lead.data, /website|url|site|web/i)
  const owner = findField(lead.data, /owner|manager|contact|name/i)
  const issue = findField(lead.data, /issue|problem|pain|reason|note/i)
  const phone = findField(lead.data, /phone|mobile|cell|tel/i)
  return (
    <Card className="mb-5 border-amber-200 bg-amber-50/40 p-5">
      <div className="mb-3 flex items-center gap-2">
        <PhoneCall className="h-4 w-4 text-amber-600" />
        <h2 className="text-[15px] font-semibold">Call card</h2>
        {lead.call_at && <span className="ml-auto text-[13px] font-medium text-amber-700">{format(new Date(lead.call_at), 'PPp')}</span>}
      </div>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Field label="Business">{lead.display_name}</Field>
        <Field label="Owner / Manager">{owner ?? '—'}</Field>
        <Field label="Website">{website ? <a href={hrefFor(website)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-[var(--color-primary)] hover:underline">{website}<ExternalLink className="h-3 w-3 shrink-0" /></a> : '—'}</Field>
        <Field label="Phone">{phone ? <a href={`tel:${digits(phone)}`} className="text-[var(--color-primary)] hover:underline">{phone}</a> : '—'}</Field>
        <div className="sm:col-span-2"><Field label="Site issue note">{issue ?? '—'}</Field></div>
      </dl>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  )
}

/** Log an activity and (per spec) prompt for the next follow-up date. */
function LogActivityDialog({ type, leadId, currentCallAt, onClose, onDone }: { type: ActivityType; leadId: string; currentCallAt: string | null; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [callAt, setCallAt] = useState(toLocalInput(currentCallAt))
  const isBooked = type === 'Booked'

  const save = useMutation({
    mutationFn: async () => {
      await activitiesApi.add(leadId, { type, note: note.trim() || null })
      const patch: Parameters<typeof manualLeadsApi.update>[1] = {}
      if (followUp) patch.next_follow_up = followUp
      if (isBooked) { patch.stage = 'Booked'; if (callAt) patch.call_at = new Date(callAt).toISOString() }
      if (Object.keys(patch).length) await manualLeadsApi.update(leadId, patch)
    },
    onSuccess: () => { toast.success('Activity logged'); onDone() },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Log: ${type}`} description="Record the touch, then set when to follow up next.">
      <div className="space-y-4">
        <div>
          <Label htmlFor="la-note">Note (optional)</Label>
          <Textarea id="la-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What happened?" />
        </div>
        {isBooked && (
          <div>
            <Label htmlFor="la-call">Call date &amp; time</Label>
            <Input id="la-call" type="datetime-local" value={callAt} onChange={(e) => setCallAt(e.target.value)} />
          </div>
        )}
        <div>
          <Label htmlFor="la-follow" className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Next follow-up date</Label>
          <Input id="la-follow" type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
          <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">Leave blank if no follow-up is needed.</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>Log activity</Button>
        </div>
      </div>
    </Dialog>
  )
}
