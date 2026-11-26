'use client'

// "Embed on your website" under Online booking on Settings › Reservations (#581, D178): the two
// things a web designer needs, the booking page's address and a ready `<iframe>`, each with Copy
// (the copy button with its toast, as the dispute evidence has it). Only the booking page's own
// origin and the sites the operator's setting names may show it in a frame; the venue's own site
// comes later, as a setting here (#609). Copying writes nothing, so a role that may not change the
// settings copies too. With the booking page off there is nothing to copy, and the block says so.
import { CopyIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type ReactNode, useId } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { WRAPS } from '@/lib/wrapping'

/** How tall the frame is by default: the booking form on a phone, without a scroll inside. */
const FRAME_HEIGHT = 800

/** The `<iframe>` a web designer pastes into the club's site. */
export function embedSnippet(address: string, title: string): string {
  const attribute = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  return (
    `<iframe src="${attribute(address)}" title="${attribute(title)}" width="100%" ` +
    `height="${FRAME_HEIGHT}" style="border:0" loading="lazy"></iframe>`
  )
}

/** Copies `text`; false where the browser does not let the page. */
async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** One thing to copy: its label, the text as it will be copied, and Copy. */
function CopyRow({
  label,
  text,
  testId,
  children,
}: {
  label: string
  text: string
  testId: string
  children: ReactNode
}) {
  const t = useTranslations('ownerSettings')
  const labelId = useId()
  const buttonId = useId()
  async function copyText() {
    if (await copy(text)) toast.success(t('rs_copied'), { id: 'rs-embed-copied' })
    else toast.error(t('rs_copy_failed'), { id: 'rs-embed-copied' })
  }
  return (
    <div className="grid grid-cols-1 gap-1">
      <span id={labelId} className="text-sm text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        <Button
          id={buttonId}
          type="button"
          variant="outline"
          size="sm"
          className={WRAPS}
          aria-labelledby={`${buttonId} ${labelId}`}
          onClick={() => void copyText()}
          data-testid={`${testId}-copy`}
        >
          <CopyIcon aria-hidden className="size-4" />
          {t('rs_copy')}
        </Button>
      </div>
    </div>
  )
}

export function EmbedBlock({ address, on }: { address: string; on: boolean }) {
  const t = useTranslations('ownerSettings')
  const title = useTranslations('meta')('bookingPage')
  const snippet = embedSnippet(address, title)
  return (
    <div className="grid grid-cols-1 gap-3 p-3" data-testid="rs-embed">
      <h3 className="text-sm font-medium">{t('rs_embed')}</h3>
      {on ? (
        <>
          <CopyRow label={t('rs_booking_address')} text={address} testId="rs-booking-address">
            <a
              href={address}
              target="_blank"
              rel="noreferrer"
              className="tap-area break-all underline underline-offset-2"
              data-testid="rs-booking-address"
            >
              {address}
            </a>
          </CopyRow>
          <CopyRow label={t('rs_embed_code')} text={snippet} testId="rs-embed-code">
            <pre
              className="overflow-x-auto rounded-md border bg-muted/40 p-2 text-xs whitespace-pre-wrap [overflow-wrap:anywhere]"
              data-testid="rs-embed-code"
            >
              <code>{snippet}</code>
            </pre>
          </CopyRow>
        </>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="rs-embed-off">
          {t('rs_embed_off')}
        </p>
      )}
    </div>
  )
}
