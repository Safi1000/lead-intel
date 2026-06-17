import * as Icons from 'lucide-react'
import type { LucideProps } from 'lucide-react'

/** Resolve a lucide icon by name (used by nav configs). */
export function Icon({ name, ...props }: { name: string } & LucideProps) {
  const Cmp = (Icons as unknown as Record<string, React.ComponentType<LucideProps>>)[name]
  const Fallback = Icons.Circle
  const C = Cmp ?? Fallback
  return <C {...props} />
}
