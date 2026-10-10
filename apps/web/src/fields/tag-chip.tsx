'use client'

// The small labels on an item: a venue tag in its colour token, a dietary label in a neutral style.
// The admin draws the five tag colours with its own theme (the guest face draws the same tokens
// with the venue's theme), so a manager sees roughly what guests will.
import type { TagColor } from '@restro/core'

import { cn } from '@/lib/utils'

/** The admin look of each tag colour token. */
export const TAG_COLOR_CLASSES: Record<TagColor, string> = {
  accent: 'border-transparent bg-primary text-primary-foreground',
  accent_text: 'border-primary/30 bg-primary/10 text-primary',
  muted: 'border-transparent bg-muted text-muted-foreground',
  text: 'border-transparent bg-foreground text-background',
  border: 'border-border bg-transparent text-foreground',
}

const CHIP =
  'inline-flex w-fit max-w-40 shrink-0 items-center gap-1 truncate rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap'

/** A venue tag. */
export function TagChip({
  color,
  children,
  className,
  tagId,
}: {
  color: TagColor
  children: React.ReactNode
  className?: string
  /** For tests and the end-to-end specs: which tag this is. */
  tagId?: string
}) {
  return (
    <span
      className={cn(CHIP, TAG_COLOR_CLASSES[color], className)}
      data-testid="tag-chip"
      data-tag-id={tagId}
      data-color={color}
    >
      {children}
    </span>
  )
}

/** A dietary label (vegan, gluten-free, …): the fixed list, drawn quietly. */
export function DietaryChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className={cn(CHIP, 'border-dashed border-border bg-transparent text-muted-foreground')}
      data-testid="dietary-chip"
    >
      {children}
    </span>
  )
}

/** The "+N" that stands for the labels a row has no room for; `title` lists them. */
export function MoreChip({ count, title }: { count: number; title: string }) {
  return (
    <span
      className={cn(CHIP, 'border-border bg-secondary text-secondary-foreground')}
      data-testid="more-chip"
      title={title}
    >
      +{count}
    </span>
  )
}
