'use client'

// image, file and reference: shown here. An image is edited on the item sheet's Media tab (upload
// and alt text), not in the generic editor; file and reference arrive later. An image shows its
// alt text and asset id, with a thumbnail when the screen has a link to the file (a value never
// holds a URL).
import { FileIcon, ImageIcon, LinkIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { ComingSoonEditor } from '../coming-soon'
import { useFieldEnvironment } from '../environment'
import { pickLocalized } from '../localized'
import type { DisplayProps, FieldUi } from '../types'

function ImageDisplay({ value }: DisplayProps<'image'>) {
  const t = useTranslations('fields.media')
  const environment = useFieldEnvironment()
  const alt = pickLocalized(value.alt, environment.locale)
  // The value holds the asset id only; a screen that has a link to the file (the item sheet)
  // passes it through the environment, otherwise the placeholder stays.
  const url = environment.assetUrls[value.asset_id]
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground">
        {url ? (
          // biome-ignore lint/performance/noImgElement: plain <img> by decision U7 (no Next.js image optimizer)
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <ImageIcon className="size-6" aria-hidden />
        )}
      </div>
      <div className="grid min-w-0 gap-0.5">
        <span className="truncate text-foreground">{alt ?? t('noAlt')}</span>
        <code className="truncate font-mono text-xs text-muted-foreground">{value.asset_id}</code>
      </div>
    </div>
  )
}

export const image = { Display: ImageDisplay, Editor: ComingSoonEditor } satisfies FieldUi<'image'>

/** Exact bytes below 1 KiB, otherwise KiB/MiB rounded to one decimal (zero-byte files show 0 B). */
export function formatFileSize(bytes: number, locale: string): string {
  const formatNumber = (value: number, options: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat(locale, options).format(value)
  if (bytes < 1024) {
    return formatNumber(bytes, { style: 'unit', unit: 'byte', unitDisplay: 'short' })
  }
  const kib = bytes / 1024
  if (kib < 1024) {
    return formatNumber(kib, {
      style: 'unit',
      unit: 'kilobyte',
      unitDisplay: 'short',
      maximumFractionDigits: 1,
    })
  }
  return formatNumber(kib / 1024, {
    style: 'unit',
    unit: 'megabyte',
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  })
}

function FileDisplay({ value }: DisplayProps<'file'>) {
  const locale = useLocale()
  return (
    <div className="flex items-center gap-3">
      <FileIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="grid min-w-0 gap-0.5">
        <span className="truncate text-foreground">{value.filename}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatFileSize(value.size, locale)}
        </span>
      </div>
    </div>
  )
}

export const file = { Display: FileDisplay, Editor: ComingSoonEditor } satisfies FieldUi<'file'>

function ReferenceDisplay({ value }: DisplayProps<'reference'>) {
  return (
    <span className="inline-flex items-center gap-1.5 text-foreground">
      <LinkIcon className="size-4 text-muted-foreground" aria-hidden />
      <code className="font-mono text-xs">{value.node_id}</code>
    </span>
  )
}

export const reference = {
  Display: ReferenceDisplay,
  Editor: ComingSoonEditor,
} satisfies FieldUi<'reference'>
