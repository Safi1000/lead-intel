import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  MessageSquare,
  Send,
  Check,
  CheckCheck,
  Inbox as InboxIcon,
  Sparkles,
  Building2,
  CheckCircle2,
  UserPlus,
} from 'lucide-react'
import { toast } from 'sonner'
import { inboxApi } from '../../api/endpoints'
import type { Conversation, ChatMessage } from '../../api/types'
import { cn } from '../../lib/utils'
import { relativeTime, absoluteTime } from '../../lib/time'
import { useRealtime } from '../../realtime/realtime'
import { Button, Textarea, Badge } from '../../components/ui/primitives'
import {
  DropdownMenu,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
  Tabs,
  TabsList,
  TabsTrigger,
} from '../../components/ui/controls'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'

type Filter = 'all' | 'unread' | 'assigned' | 'resolved'
const TEAMMATES = ['Jordan Lee', 'Sam Patel', 'Riley Chen']

export function InboxPage() {
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['inbox'],
    queryFn: () => inboxApi.list(),
  })

  const conversations = useMemo(() => {
    const list = data ?? []
    switch (filter) {
      case 'unread':
        return list.filter((c) => c.unread > 0)
      case 'assigned':
        return list.filter((c) => !!c.assignee)
      case 'resolved':
        return list.filter((c) => c.resolved)
      default:
        return list
    }
  }, [data, filter])

  return (
    <div className="reveal">
      <PageHeader title="Inbox" subtitle="Two-way WhatsApp conversations with your leads." />

      <div className="grid h-[calc(100vh-220px)] min-h-[480px] grid-cols-1 gap-0 overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] md:grid-cols-[320px_1fr]">
        {/* Left pane */}
        <div className="flex flex-col border-b border-[var(--color-border)] md:border-b-0 md:border-r">
          <div className="border-b border-[var(--color-border)] px-3 pt-2">
            <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
              <TabsList className="border-b-0">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="unread">Unread</TabsTrigger>
                <TabsTrigger value="assigned">Assigned</TabsTrigger>
                <TabsTrigger value="resolved">Resolved</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <LoadingState label="Loading conversations…" />
            ) : isError ? (
              <ErrorState onRetry={() => refetch()} />
            ) : conversations.length === 0 ? (
              <EmptyState
                icon={InboxIcon}
                title="No conversations"
                message="Replies from your campaigns will show up here."
              />
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => setSelectedId(c.id)}
                      className={cn(
                        'flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-slate-50',
                        selectedId === c.id && 'bg-slate-50',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 truncate font-medium text-[var(--color-text)]">
                          {c.resolved && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600" />}
                          {c.business_name}
                        </span>
                        <span className="shrink-0 text-[11px] text-[var(--color-text-muted)]">
                          {relativeTime(c.updated_at)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] text-[var(--color-text-secondary)]">
                          {c.last_message}
                        </span>
                        {c.unread > 0 && (
                          <span
                            className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold text-white"
                            style={{ backgroundColor: 'var(--color-signal)' }}
                          >
                            {c.unread}
                          </span>
                        )}
                      </div>
                      {c.assignee && (
                        <span className="text-[11px] text-[var(--color-text-muted)]">Assigned to {c.assignee}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right pane */}
        <div className="flex min-h-0 flex-col">
          {selectedId ? (
            <ConversationPane key={selectedId} id={selectedId} />
          ) : (
            <EmptyState
              icon={MessageSquare}
              title="No conversation selected"
              message="Pick a conversation on the left to read and reply."
              className="m-auto"
            />
          )}
        </div>
      </div>
    </div>
  )
}

function ConversationPane({ id }: { id: string }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [assignee, setAssignee] = useState<string | null>(null)
  const [localIncoming, setLocalIncoming] = useState<ChatMessage[]>([])

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['inbox', id],
    queryFn: () => inboxApi.conversation(id),
    enabled: !!id,
  })

  // Optional realtime incoming — safe no-op when no events arrive.
  useRealtime(id ? `inbox:${id}` : null, (payload) => {
    const p = payload as Partial<ChatMessage> | null
    if (!p || !p.text) return
    setLocalIncoming((prev) => [
      ...prev,
      {
        id: p.id ?? `rt-${Date.now()}`,
        direction: 'in',
        text: p.text!,
        at: p.at ?? new Date().toISOString(),
        status: p.status,
      },
    ])
  })

  const reply = useMutation({
    mutationFn: (text: string) => inboxApi.reply(id, text),
    onSuccess: (msg) => {
      qc.setQueryData<{ conversation: Conversation; messages: ChatMessage[] }>(['inbox', id], (old) =>
        old ? { ...old, messages: [...old.messages, msg] } : old,
      )
      setDraft('')
      setSuggestions([])
    },
    onError: () => toast.error('Couldn’t send reply'),
  })

  const suggest = useMutation({
    mutationFn: () => inboxApi.suggest(id),
    onSuccess: (r) => setSuggestions(r.suggestions),
    onError: () => toast.error('Couldn’t generate suggestions'),
  })

  if (isLoading) return <LoadingState label="Loading conversation…" />
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />

  const messages = [...data.messages, ...localIncoming]
  const effectiveAssignee = assignee ?? data.conversation.assignee ?? null

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate font-semibold text-[var(--color-text)]">{data.conversation.business_name}</h2>
          <p className="truncate text-[12px] text-[var(--color-text-muted)]">
            {effectiveAssignee ? `Assigned to ${effectiveAssignee}` : 'Unassigned'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DropdownMenu>
            <DropdownTrigger asChild>
              <Button variant="outline" size="sm">
                <UserPlus className="h-3.5 w-3.5" /> Assign
              </Button>
            </DropdownTrigger>
            <DropdownContent>
              {TEAMMATES.map((t) => (
                <DropdownItem
                  key={t}
                  onSelect={() => {
                    setAssignee(t)
                    toast.success(`Assigned to ${t}`)
                  }}
                >
                  {t}
                </DropdownItem>
              ))}
            </DropdownContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            onClick={() => toast.success('Conversation marked resolved')}
            disabled={data.conversation.resolved}
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> {data.conversation.resolved ? 'Resolved' : 'Mark resolved'}
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_240px]">
        {/* Thread + composer */}
        <div className="flex min-h-0 flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <EmptyState icon={MessageSquare} title="No messages" message="Start the conversation below." />
            ) : (
              messages.map((m) => <MessageBubble key={m.id} message={m} />)
            )}
          </div>

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div className="border-t border-[var(--color-border)] px-4 py-2">
              <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-[var(--color-text-muted)]">
                <Sparkles className="h-3 w-3 text-[var(--color-primary)]" /> AI-generated suggestions
              </p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setDraft(s)}
                    className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1 text-[13px] text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Composer */}
          <div className="border-t border-[var(--color-border)] p-3">
            <div className="flex items-end gap-2">
              <Textarea
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type a reply…"
                className="resize-none"
              />
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  loading={suggest.isPending}
                  onClick={() => suggest.mutate()}
                >
                  <Sparkles className="h-3.5 w-3.5" /> AI suggest
                </Button>
                <Button
                  size="sm"
                  disabled={draft.trim().length === 0 || reply.isPending}
                  loading={reply.isPending}
                  onClick={() => reply.mutate(draft.trim())}
                >
                  <Send className="h-3.5 w-3.5" /> Send
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Lead context panel */}
        <aside className="hidden border-l border-[var(--color-border)] p-4 lg:block">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            Lead context
          </p>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-surface-2)]">
              <Building2 className="h-4 w-4 text-[var(--color-text-secondary)]" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-medium text-[var(--color-text)]">{data.conversation.business_name}</p>
              <p className="text-[11px] text-[var(--color-text-muted)]">Enriched lead</p>
            </div>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
            This contact comes from your enriched lead database. Open the lead record for owner phone, email, and
            confidence signals.
          </p>
          <div className="mt-3">
            <Badge className="bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">
              Lead #{data.conversation.lead_id}
            </Badge>
          </div>
        </aside>
      </div>
    </>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const out = message.direction === 'out'
  return (
    <div className={cn('flex', out ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[78%] rounded-[12px] px-3 py-2 text-sm',
          out
            ? 'bg-[var(--color-primary)] text-white'
            : 'border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)]',
        )}
      >
        <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>
        <div
          className={cn(
            'mt-1 flex items-center justify-end gap-1 text-[10px]',
            out ? 'text-white/70' : 'text-[var(--color-text-muted)]',
          )}
        >
          <span title={absoluteTime(message.at)}>{relativeTime(message.at)}</span>
          {out && <DeliveryTick status={message.status} />}
        </div>
      </div>
    </div>
  )
}

function DeliveryTick({ status }: { status?: ChatMessage['status'] }) {
  if (status === 'read') return <CheckCheck className="h-3 w-3 text-sky-200" aria-label="read" />
  if (status === 'delivered') return <CheckCheck className="h-3 w-3" aria-label="delivered" />
  return <Check className="h-3 w-3" aria-label="sent" />
}
