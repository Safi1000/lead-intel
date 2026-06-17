import * as React from 'react'
import * as RDropdown from '@radix-ui/react-dropdown-menu'
import * as RTooltip from '@radix-ui/react-tooltip'
import * as RTabs from '@radix-ui/react-tabs'
import * as RSwitch from '@radix-ui/react-switch'
import * as RCheckbox from '@radix-ui/react-checkbox'
import * as RPopover from '@radix-ui/react-popover'
import * as RSlider from '@radix-ui/react-slider'
import { Check } from 'lucide-react'
import { cn } from '../../lib/utils'

// ---- Tooltip ----
export function Tooltip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  if (!content) return <>{children}</>
  return (
    <RTooltip.Provider delayDuration={200}>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content
            sideOffset={6}
            className="z-50 max-w-xs rounded-md bg-slate-900 px-2.5 py-1.5 text-[12px] text-white shadow-lg"
          >
            {content}
            <RTooltip.Arrow className="fill-slate-900" />
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  )
}

// ---- Dropdown menu ----
export const DropdownMenu = RDropdown.Root
export const DropdownTrigger = RDropdown.Trigger
export function DropdownContent({
  children,
  align = 'end',
  className,
}: {
  children: React.ReactNode
  align?: 'start' | 'end' | 'center'
  className?: string
}) {
  return (
    <RDropdown.Portal>
      <RDropdown.Content
        align={align}
        sideOffset={6}
        className={cn(
          'z-50 min-w-44 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-lg',
          className,
        )}
      >
        {children}
      </RDropdown.Content>
    </RDropdown.Portal>
  )
}
export function DropdownItem({
  children,
  onSelect,
  destructive,
  disabled,
}: {
  children: React.ReactNode
  onSelect?: () => void
  destructive?: boolean
  disabled?: boolean
}) {
  return (
    <RDropdown.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-slate-100 data-[disabled]:opacity-40',
        destructive ? 'text-[var(--c-unverified)]' : 'text-[var(--color-text)]',
      )}
    >
      {children}
    </RDropdown.Item>
  )
}
export const DropdownSeparator = () => (
  <RDropdown.Separator className="my-1 h-px bg-[var(--color-border)]" />
)

// ---- Tabs ----
export function Tabs({
  value,
  onValueChange,
  children,
  className,
}: {
  value: string
  onValueChange: (v: string) => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <RTabs.Root value={value} onValueChange={onValueChange} className={className}>
      {children}
    </RTabs.Root>
  )
}
export function TabsList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <RTabs.List className={cn('flex gap-1 overflow-x-auto border-b border-[var(--color-border)]', className)}>
      {children}
    </RTabs.List>
  )
}
export function TabsTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <RTabs.Trigger
      value={value}
      className="whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors data-[state=active]:border-[var(--color-primary)] data-[state=active]:text-[var(--color-primary)]"
    >
      {children}
    </RTabs.Trigger>
  )
}

// ---- Switch ----
export function Switch({
  checked,
  onCheckedChange,
  id,
  disabled,
}: {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  id?: string
  disabled?: boolean
}) {
  return (
    <RSwitch.Root
      id={id}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      className="relative h-5 w-9 rounded-full bg-slate-300 transition-colors data-[state=checked]:bg-[var(--color-primary)] disabled:opacity-40"
    >
      <RSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-[18px]" />
    </RSwitch.Root>
  )
}

// ---- Checkbox ----
export function Checkbox({
  checked,
  onCheckedChange,
  'aria-label': ariaLabel,
}: {
  checked: boolean | 'indeterminate'
  onCheckedChange: (v: boolean) => void
  'aria-label'?: string
}) {
  return (
    <RCheckbox.Root
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(Boolean(v))}
      aria-label={ariaLabel}
      className="flex h-4 w-4 items-center justify-center rounded border border-slate-300 bg-white data-[state=checked]:border-[var(--color-primary)] data-[state=checked]:bg-[var(--color-primary)] data-[state=indeterminate]:border-[var(--color-primary)] data-[state=indeterminate]:bg-[var(--color-primary)]"
    >
      <RCheckbox.Indicator>
        <Check className="h-3 w-3 text-white" />
      </RCheckbox.Indicator>
    </RCheckbox.Root>
  )
}

// ---- Popover ----
export const Popover = RPopover.Root
export const PopoverTrigger = RPopover.Trigger
export function PopoverContent({
  children,
  align = 'start',
  className,
}: {
  children: React.ReactNode
  align?: 'start' | 'end' | 'center'
  className?: string
}) {
  return (
    <RPopover.Portal>
      <RPopover.Content
        align={align}
        sideOffset={6}
        className={cn(
          'z-50 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-lg',
          className,
        )}
      >
        {children}
      </RPopover.Content>
    </RPopover.Portal>
  )
}

// ---- Slider ----
export function Slider({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
}: {
  value: number
  onValueChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <RSlider.Root
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={(v) => onValueChange(v[0])}
      className="relative flex h-5 w-full touch-none items-center"
    >
      <RSlider.Track className="relative h-1.5 w-full grow rounded-full bg-slate-200">
        <RSlider.Range className="absolute h-full rounded-full bg-[var(--color-primary)]" />
      </RSlider.Track>
      <RSlider.Thumb className="block h-4 w-4 rounded-full border-2 border-[var(--color-primary)] bg-white shadow" aria-label="value" />
    </RSlider.Root>
  )
}
