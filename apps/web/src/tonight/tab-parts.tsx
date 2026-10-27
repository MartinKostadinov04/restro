'use client'

// Parts the Tonight tabs share (#86): the heading, the still "{k} new · show" line, the "Show
// earlier" button, the failed-to-load block and the loading rows.
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'

/** "Tonight" and the tab's own name, as screen 1 heads its panel. */
export function TabHeading({ name }: { name: string }) {
  const t = useTranslations('tonight')
  return (
    <h2 className="text-xl font-semibold tracking-tight">
      {t('title')}
      <span className="ml-2 text-base font-normal text-muted-foreground">{name}</span>
    </h2>
  )
}

/** Rows that came while the list was read further down: one still line, one tap shows them. */
export function NewLine({ k, onShow }: { k: number; onShow: () => void }) {
  const t = useTranslations('tonight')
  if (k === 0) return null
  return (
    <Button
      type="button"
      variant="outline"
      className="h-11 w-full"
      data-testid="new-line"
      onClick={onShow}
    >
      {t('so_new', { k })}
    </Button>
  )
}

export function ShowEarlier({ onClick }: { onClick: () => void }) {
  const t = useTranslations('tonight')
  return (
    <Button
      type="button"
      variant="outline"
      className="h-11 w-full"
      data-testid="show-earlier"
      onClick={onClick}
    >
      {t('so_earlier')}
    </Button>
  )
}

/** A list that cannot load: what to do, in place of the list; it tries again by itself. */
export function FailedBlock({ text }: { text: string }) {
  return (
    <Empty className="p-6 md:p-6" role="alert" data-testid="load-failed">
      <EmptyHeader>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

/** A block with a title and a line, and optionally one button. */
export function NothingHere({
  title,
  text,
  action,
}: {
  title?: string
  text: string
  action?: React.ReactNode
}) {
  return (
    <Empty className="p-6 md:p-6" data-testid="nothing-here">
      <EmptyHeader>
        {title === undefined ? null : <EmptyTitle>{title}</EmptyTitle>}
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
      {action}
    </Empty>
  )
}

/** Skeleton rows while the first rows load: no spinner, no text over it. */
export function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-hidden className="space-y-2">
      {Array.from({ length: rows }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: identical placeholders
        <Skeleton key={index} className="h-16 w-full motion-reduce:animate-none" />
      ))}
    </div>
  )
}
