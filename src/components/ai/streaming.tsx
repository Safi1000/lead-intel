import * as React from 'react'
import { Copy, Check, RefreshCw, Sparkles, ChevronDown, Square, AlertCircle } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/primitives'

/** Shared AI streaming UI kit (§I-7). Output is always labeled as generated. */

export const AI_PROVIDERS = ['claude-opus-4-8', 'gpt-4o', 'gemini-2.0', 'llama-3-70b'] as const
export type AIProvider = (typeof AI_PROVIDERS)[number]

export function AIProviderBadge({ provider = 'claude-opus-4-8' }: { provider?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
      <Sparkles className="h-3 w-3 text-[var(--color-primary)]" /> {provider}
    </span>
  )
}

/**
 * Streaming text — simulates token streaming from a final string so the mock
 * build feels like a real stream. Swap the source for an SSE reader later.
 */
export function useStream(text: string | null, deps: unknown[] = []) {
  const [shown, setShown] = React.useState('')
  const [streaming, setStreaming] = React.useState(false)
  const stopped = React.useRef(false)

  React.useEffect(() => {
    if (!text) {
      setShown('')
      return
    }
    stopped.current = false
    setStreaming(true)
    setShown('')
    const tokens = text.split(/(\s+)/)
    let i = 0
    const id = setInterval(() => {
      if (stopped.current || i >= tokens.length) {
        clearInterval(id)
        setStreaming(false)
        if (!stopped.current) setShown(text)
        return
      }
      setShown((s) => s + tokens[i])
      i++
    }, 24)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { shown, streaming, stop: () => (stopped.current = true) }
}

export function StreamingText({
  text,
  streaming,
  onStop,
  className,
}: {
  text: string
  streaming: boolean
  onStop?: () => void
  className?: string
}) {
  return (
    <div className={cn('text-sm leading-relaxed text-[var(--color-text)]', className)} aria-live="polite">
      <span className="whitespace-pre-wrap">{text}</span>
      {streaming && (
        <>
          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-[var(--color-primary)] align-middle" />
          {onStop && (
            <button onClick={onStop} className="ml-2 inline-flex items-center gap-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
              <Square className="h-3 w-3" /> Stop
            </button>
          )}
        </>
      )}
    </div>
  )
}

export function GenerationControls({
  onRegenerate,
  onCopy,
  copyValue,
  extra,
}: {
  onRegenerate?: () => void
  onCopy?: () => void
  copyValue?: string
  extra?: React.ReactNode
}) {
  const [copied, setCopied] = React.useState(false)
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {onRegenerate && (
        <Button size="sm" variant="outline" onClick={onRegenerate}>
          <RefreshCw className="h-3.5 w-3.5" /> Regenerate
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          if (copyValue) navigator.clipboard?.writeText(copyValue)
          onCopy?.()
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-[var(--c-verified)]" /> : <Copy className="h-3.5 w-3.5" />} Copy
      </Button>
      {extra}
      <span className="ml-auto text-[11px] text-[var(--color-text-muted)]">AI-generated — review before sending</span>
    </div>
  )
}

export function VariantTabs({
  variants,
  active,
  onChange,
}: {
  variants: string[]
  active: string
  onChange: (v: string) => void
}) {
  return (
    <div className="inline-flex rounded-[8px] border border-[var(--color-border)] p-0.5">
      {variants.map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={cn(
            'rounded-[6px] px-3 py-1 text-[13px] font-medium capitalize transition-colors',
            active === v ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]',
          )}
        >
          {v}
        </button>
      ))}
    </div>
  )
}

export function RationaleDisclosure({ title = 'Why this result', children }: { title?: string; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  return (
    <div className="mt-3 rounded-[8px] border border-[var(--color-border)]">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3 py-2 text-[13px] font-medium text-[var(--color-text-secondary)]">
        {title}
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="border-t border-[var(--color-border)] px-3 py-2 text-[13px] text-[var(--color-text-secondary)]">{children}</div>}
    </div>
  )
}

export function AINotConfigured() {
  return (
    <div className="flex items-start gap-2 rounded-[8px] border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        No AI provider configured. Set one in{' '}
        <a href="/settings/ai-providers" className="font-medium underline">AI Providers</a> to enable generation.
      </span>
    </div>
  )
}
