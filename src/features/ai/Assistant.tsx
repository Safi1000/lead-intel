import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Bot, Send, Sparkles, Wand2, User as UserIcon, ListFilter } from 'lucide-react'
import { aiApi } from '../../api/endpoints'
import type { AssistantResult, LeadRow, RunBuilderDraft } from '../../api/types'
import { Button, Card, Input } from '../../components/ui/primitives'
import { Tabs, TabsList, TabsTrigger, Switch } from '../../components/ui/controls'
import { EmptyState } from '../../components/feedback'
import { PageHeader, SectionCard } from '../shared/bits'
import { StreamingText, useStream, AIProviderBadge } from '../../components/ai/streaming'
import { ConfidenceDot } from '../../components/confidence'
import { cn } from '../../lib/utils'

type ChatMsg =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; text: string; provider: string; table?: LeadRow[] }

const SUGGESTED = [
  'Show hot roofers with no website',
  'Which leads have owner phone?',
  'Summarize my Austin market',
]

let _id = 0
const nextId = () => `m${++_id}`

function AssistantBubble({ msg, isLast }: { msg: Extract<ChatMsg, { role: 'assistant' }>; isLast: boolean }) {
  const navigate = useNavigate()
  const { shown, streaming, stop } = useStream(isLast ? msg.text : null, [msg.id])
  const text = isLast ? shown : msg.text
  return (
    <div className="reveal flex w-full justify-start">
      <div className="max-w-[80%] rounded-[12px] rounded-tl-sm border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-surface-2)]">
            <Bot className="h-3.5 w-3.5 text-[var(--color-primary)]" />
          </span>
          <AIProviderBadge provider={msg.provider} />
        </div>
        <StreamingText text={text} streaming={isLast && streaming} onStop={stop} />
        {msg.table && msg.table.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-[8px] border border-[var(--color-border)]">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-[var(--color-surface-2)] text-left text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th className="px-3 py-2 font-medium">Business</th>
                  <th className="px-3 py-2 font-medium">Owner</th>
                  <th className="px-3 py-2 font-medium">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {msg.table.map((lead) => (
                  <tr key={lead.id} className="text-[var(--color-text)]">
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <ConfidenceDot status={lead.row_confidence} />
                        {lead.business_name}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                      {lead.owner_name.value ?? '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{lead.score ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  toast.success('Opening matching leads as a filtered list')
                  navigate('/runs')
                }}
              >
                <ListFilter className="h-3.5 w-3.5" /> Open as filtered list
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AskMode() {
  const [messages, setMessages] = React.useState<ChatMsg[]>([])
  const [draft, setDraft] = React.useState('')
  const scrollRef = React.useRef<HTMLDivElement>(null)

  const mutation = useMutation({
    mutationFn: (message: string) => aiApi.assistant(message),
    onSuccess: (res: AssistantResult) => {
      setMessages((m) => [
        ...m,
        { id: nextId(), role: 'assistant', text: res.answer, provider: res.provider, table: res.table },
      ])
    },
    onError: () => toast.error('Could not reach the assistant. Try again.'),
  })

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, mutation.isPending])

  const send = (raw?: string) => {
    const text = (raw ?? draft).trim()
    if (!text || mutation.isPending) return
    setMessages((m) => [...m, { id: nextId(), role: 'user', text }])
    setDraft('')
    mutation.mutate(text)
  }

  return (
    <SectionCard title="Ask the assistant" className="reveal">
      <div className="flex h-[58vh] flex-col">
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {messages.length === 0 && !mutation.isPending ? (
            <EmptyState
              icon={Sparkles}
              title="Ask anything about your leads"
              message="Query your delivered data in plain language. Try one of the prompts below."
            />
          ) : (
            messages.map((msg, i) =>
              msg.role === 'user' ? (
                <div key={msg.id} className="reveal flex w-full justify-end">
                  <div className="flex max-w-[80%] items-start gap-2">
                    <div className="rounded-[12px] rounded-tr-sm bg-[var(--color-primary)] px-3 py-2 text-sm text-white">
                      {msg.text}
                    </div>
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)]">
                      <UserIcon className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
                    </span>
                  </div>
                </div>
              ) : (
                <AssistantBubble
                  key={msg.id}
                  msg={msg}
                  isLast={i === messages.length - 1}
                />
              ),
            )
          )}
          {mutation.isPending && (
            <div className="flex items-center gap-2 px-1 text-sm text-[var(--color-text-muted)]">
              <Bot className="h-4 w-4 animate-pulse text-[var(--color-primary)]" /> Thinking…
            </div>
          )}
        </div>

        <div className="border-t border-[var(--color-border)] px-5 py-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SUGGESTED.map((p) => (
              <button
                key={p}
                onClick={() => send(p)}
                disabled={mutation.isPending}
                className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-text)] disabled:opacity-50"
              >
                {p}
              </button>
            ))}
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about your delivered lead data…"
              aria-label="Message"
            />
            <Button type="submit" loading={mutation.isPending} disabled={!draft.trim()}>
              <Send className="h-4 w-4" /> Send
            </Button>
          </form>
        </div>
      </div>
    </SectionCard>
  )
}

function BuildMode() {
  const navigate = useNavigate()
  const [text, setText] = React.useState('')
  const [draft, setDraft] = React.useState<RunBuilderDraft | null>(null)

  const mutation = useMutation({
    mutationFn: (t: string) => aiApi.runBuilder(t),
    onSuccess: (res) => setDraft(res),
    onError: () => toast.error('Could not parse that. Try rephrasing.'),
  })

  return (
    <SectionCard title="Describe a run" className="reveal">
      <div className="space-y-4 p-5">
        <p className="text-sm text-[var(--color-text-secondary)]">
          Describe the run you want in plain language and we’ll draft a config. Nothing launches
          automatically — you confirm on the next screen.
        </p>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim()) mutation.mutate(text.trim())
          }}
        >
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Find roofers in Austin with owner phone numbers"
            aria-label="Run description"
          />
          <Button type="submit" loading={mutation.isPending} disabled={!text.trim()}>
            <Wand2 className="h-4 w-4" /> Parse
          </Button>
        </form>

        {mutation.isError && (
          <p className="text-sm text-[var(--c-unverified)]">Couldn’t parse that input.</p>
        )}

        {draft && (
          <Card className="reveal bg-[var(--color-surface-2)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-[var(--color-text)]">Parsed run config</h3>
              <span className="text-[12px] text-[var(--color-text-muted)]">
                Confidence {Math.round(draft.confidence * 100)}%
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                  Trade
                </span>
                <Input
                  value={draft.trade}
                  onChange={(e) => setDraft({ ...draft, trade: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                  City
                </span>
                <Input
                  value={draft.city}
                  onChange={(e) => setDraft({ ...draft, city: e.target.value })}
                />
              </label>
            </div>
            <div className="mt-3 flex items-center justify-between rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5">
              <span className="text-sm text-[var(--color-text)]">Include owner phone</span>
              <Switch
                checked={draft.include_owner_phone}
                onCheckedChange={(v) => setDraft({ ...draft, include_owner_phone: v })}
              />
            </div>
            <div className="mt-4 flex justify-end">
              <Button
                onClick={() => {
                  toast.success('Config ready — confirm to launch')
                  navigate('/runs/new')
                }}
              >
                <Sparkles className="h-4 w-4" /> Review &amp; launch
              </Button>
            </div>
          </Card>
        )}
      </div>
    </SectionCard>
  )
}

export function AssistantPage() {
  const [tab, setTab] = React.useState('ask')
  return (
    <div className="reveal">
      <PageHeader
        title="Assistant"
        subtitle="Ask about your delivered lead data, or describe a run to launch."
      />
      <Tabs value={tab} onValueChange={setTab} className="mb-4">
        <TabsList>
          <TabsTrigger value="ask">
            <span className={cn('inline-flex items-center gap-1.5')}>
              <Bot className="h-4 w-4" /> Ask
            </span>
          </TabsTrigger>
          <TabsTrigger value="build">
            <span className="inline-flex items-center gap-1.5">
              <Wand2 className="h-4 w-4" /> Build a run
            </span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'ask' ? <AskMode /> : <BuildMode />}
    </div>
  )
}
