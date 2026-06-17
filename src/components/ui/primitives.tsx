import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'

// ---- Button ----
type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] shadow-sm',
  secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200',
  outline:
    'border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-slate-50',
  ghost: 'text-[var(--color-text-secondary)] hover:bg-slate-100',
  danger: 'bg-[var(--c-unverified)] text-white hover:brightness-95 shadow-sm',
}
const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-base gap-2',
  icon: 'h-9 w-9 justify-center',
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-[8px] font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  ),
)
Button.displayName = 'Button'

// ---- Input ----
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(({ className, invalid, ...props }, ref) => (
  <input
    ref={ref}
    aria-invalid={invalid}
    className={cn(
      'h-9 w-full rounded-[8px] border bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] transition-colors focus:border-[var(--color-primary)] focus-visible:outline-none',
      invalid ? 'border-[var(--c-unverified)]' : 'border-[var(--color-border)]',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-primary)] focus-visible:outline-none',
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('mb-1.5 block text-sm font-medium text-[var(--color-text)]', className)}
      {...props}
    />
  )
}

export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="mt-1 text-[13px] text-[var(--c-unverified)]">
      {children}
    </p>
  )
}

// ---- Card ----
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm',
        className,
      )}
      {...props}
    />
  )
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4', className)} {...props} />
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-[16px] font-semibold text-[var(--color-text)]', className)} {...props} />
}
export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />
}

// ---- Badge ----
export function Badge({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium',
        className,
      )}
    >
      {children}
    </span>
  )
}

// ---- Skeleton ----
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-md', className)} aria-hidden />
}

// ---- Spinner ----
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-[var(--color-text-muted)]', className)} aria-label="Loading" />
}
