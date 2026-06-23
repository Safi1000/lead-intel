import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft, Check, Copy, ExternalLink, MessageCircle, Phone, Send } from 'lucide-react'
import { manualLeadsApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { ROLE_LABELS } from '../../config/permissions'
import { useAuth } from '../../hooks'
import { Button, Card, Textarea } from '../../components/ui/primitives'
import { ErrorState, LoadingState } from '../../components/feedback'
import { toast } from 'sonner'
import { cn } from '../../lib/utils'
import { STATUS_META, TEMP_META, actionsFor, canWorkLeads, type LeadPatch } from './workflow'
import type { Temperature } from '../../api/types'

const digits = (s: string) => s.replace(/[^\d]/g, '')
const looksEmail = (s: string) => /^\S+@\S+\.\S+$/.test(s.trim())
const looksPhone = (s: string) => digits(s).length >= 7 && /^[\d\s+().-]+$/.test(s.trim())
const looksUrl = (s: string) => {
  const v = s.trim()
  if (v.includes('@') || v.includes(' ')) return false
  return /^(https?:\/\/|www\.)/i.test(v) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v)
}
const hrefFor = (s: string) => (/^https?:\/\//i.test(s.trim()) ? s.trim() : `https://${s.trim().replace(/^\/+/, '')}`)

/** Small click-to-copy button; appears on hover of its `.group` parent. */
function CopyButton({ text, className }: { text: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      title="Copy"
      aria-label="Copy"
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
      className={cn('shrink-0 rounded p-1 text-[var(--color-text-muted)] transition hover:bg-slate-100 hover:text-[var(--color-text)]', className)}
    >
      {done ? <Check className="h-3.5 w-3.5 text-[var(--c-verified)]" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

/** Renders a lead value as a link when it looks like an email / URL. */
function LeadValue({ value }: { value: string }) {
  const v = value.trim()
  if (!v) return <span className="text-[var(--color-text-muted)]">—</span>
  if (looksEmail(v)) return <a href={`mailto:${v}`} className="break-all text-[var(--color-primary)] hover:underline">{value}</a>
  if (looksUrl(v))
    return (
      <a href={hrefFor(v)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-[var(--color-primary)] hover:underline">
        {value}
        <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
    )
  return <span className="break-words">{value}</span>
}

export function ManualLeadDetailPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { role, user } = useAuth()
  const me = user?.name ?? ''
  const canWork = canWorkLeads(role)

  const { data: lead, isLoading, isError, refetch } = useQuery({
    queryKey: ['manual-lead', id],
    queryFn: () => manualLeadsApi.get(id as string),
    enabled: !!id,
  })

  const [remark, setRemark] = useState('')

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['manual-lead', id] })
    qc.invalidateQueries({ queryKey: ['manual-leads'] })
    qc.invalidateQueries({ queryKey: ['lead-batches'] })
    qc.invalidateQueries({ queryKey: ['org-user-stats'] })
  }

  const update = useMutation({
    mutationFn: (patch: LeadPatch & { temperature?: Temperature }) => manualLeadsApi.update(id as string, patch),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(normalizeError(e).message),
  })

  const addRemark = useMutation({
    mutationFn: () => manualLeadsApi.addRemark(id as string, { text: remark, author: me, author_role: role! }),
    onSuccess: () => {
      setRemark('')
      toast.success('Remark added')
      invalidate()
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  if (isLoading) return <LoadingState />
  if (isError || !lead) return <ErrorState onRetry={() => refetch()} />

  const st = STATUS_META[lead.status]
  const actions = canWork ? actionsFor(role, lead, me) : []
  const backTo = lead.batch_id ? `/leads/batch/${lead.batch_id}` : '/leads'

  return (
    <div className="reveal mx-auto max-w-4xl">
      <Link to={backTo} className="mb-4 inline-flex items-center gap-1 text-[13px] text-[var(--color-primary)] hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to batch
      </Link>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="group min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="truncate text-[24px] font-bold tracking-tight">{lead.display_name}</h1>
            <CopyButton text={lead.display_name} />
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">From template “{lead.template_name}”</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('inline-flex rounded-full px-2.5 py-1 text-[13px] font-medium', st.className)}>{st.label}</span>
          {lead.temperature && <TempBadge temp={lead.temperature} />}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Lead data */}
        <div className="space-y-5 lg:col-span-2">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Lead details</h2>
              <button
                type="button"
                onClick={async () => {
                  const all = Object.entries(lead.data).map(([k, v]) => `${k}: ${v}`).join('\n')
                  try { await navigator.clipboard.writeText(all); toast.success('All fields copied') } catch { toast.error('Could not copy') }
                }}
                className="inline-flex items-center gap-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                <Copy className="h-3.5 w-3.5" /> Copy all
              </button>
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

          {/* Remarks */}
          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Remarks {lead.remarks.length > 0 && <span className="text-[var(--color-text-muted)]">({lead.remarks.length})</span>}</h2>
            {lead.remarks.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">No remarks yet. Setters leave notes here for the closer.</p>
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
                <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} rows={3} placeholder="Add a remark for the closer…" />
                <div className="mt-2 flex justify-end">
                  <Button size="sm" loading={addRemark.isPending} disabled={!remark.trim()} onClick={() => addRemark.mutate()}>
                    <Send className="h-3.5 w-3.5" /> Add remark
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Sidebar: actions */}
        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Assignment</h2>
            <dl className="space-y-2 text-sm">
              <div className="group flex items-center justify-between gap-2">
                <dt className="text-[var(--color-text-muted)]">Setter</dt>
                <dd className="flex items-center gap-1">{lead.setter ?? '—'}{lead.setter && <CopyButton text={lead.setter} />}</dd>
              </div>
              <div className="group flex items-center justify-between gap-2">
                <dt className="text-[var(--color-text-muted)]">Closer</dt>
                <dd className="flex items-center gap-1">{lead.closer ?? '—'}{lead.closer && <CopyButton text={lead.closer} />}</dd>
              </div>
              <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Updated</dt><dd>{formatDistanceToNow(new Date(lead.updated_at), { addSuffix: true })}</dd></div>
            </dl>
          </Card>

          {canWork && (
            <Card className="p-5">
              <h2 className="mb-3 text-[15px] font-semibold">Classify</h2>
              <div className="flex gap-2">
                {(['warm', 'cold'] as const).map((t) => {
                  const meta = TEMP_META[t]
                  const active = lead.temperature === t
                  return (
                    <Button
                      key={t}
                      variant={active ? 'primary' : 'outline'}
                      size="sm"
                      className="flex-1"
                      loading={update.isPending && update.variables?.temperature === t}
                      onClick={() => update.mutate({ temperature: active ? null : t })}
                    >
                      <meta.icon className="h-4 w-4" /> {meta.label}
                    </Button>
                  )
                })}
              </div>
            </Card>
          )}

          {canWork && actions.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-3 text-[15px] font-semibold">Actions</h2>
              <div className="space-y-2">
                {actions.map((a) => (
                  <Button
                    key={a.key}
                    variant={a.variant}
                    className="w-full justify-center"
                    loading={update.isPending && update.variables?.status === a.patch.status}
                    onClick={() => update.mutate(a.patch)}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function TempBadge({ temp }: { temp: Exclude<Temperature, null> }) {
  const meta = TEMP_META[temp]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-medium', meta.className)}>
      <meta.icon className="h-3.5 w-3.5" /> {meta.label}
    </span>
  )
}
