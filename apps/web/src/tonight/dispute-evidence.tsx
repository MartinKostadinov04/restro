'use client'

// The "Dispute evidence" section of a payment's sheet (#222; D122 §8, decision log 5.12, 5.13), for
// managers and owners. The text is one pure function of core (`disputeEvidenceText`), made in both
// languages on the server, so "Copy as text" (the screen's language), "Copy in English" and "Print"
// show the same fields. Restro never answers a dispute: the note says where to paste it. Print
// writes the text into a page of its own (the browser saves it as a PDF), with no link, no card
// digits and no device identifier in it.
import { CopyIcon, PrinterIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

const PRINT_ROOT = 'evidence-print-root'
const PRINT_STYLE = 'evidence-print-style'

/** The rules that print only the evidence page: the sheet itself is hidden in print. */
export const EVIDENCE_PRINT_CSS = `
@media screen { #${PRINT_ROOT} { display: none; } }
@media print {
  body > *:not(#${PRINT_ROOT}) { display: none !important; }
  #${PRINT_ROOT} { display: block; margin: 0; padding: 0; color: #000; background: #fff;
    font: 12pt/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
}
`

/** Opens the browser's print dialog for `text` alone, then takes the page away again. */
export function printEvidence(text: string, doc: Document = document): void {
  const style = doc.createElement('style')
  style.id = PRINT_STYLE
  style.textContent = EVIDENCE_PRINT_CSS
  const root = doc.createElement('div')
  root.id = PRINT_ROOT
  root.textContent = text
  doc.head.append(style)
  doc.body.append(root)
  const cleanUp = () => {
    style.remove()
    root.remove()
    window.removeEventListener('afterprint', cleanUp)
  }
  window.addEventListener('afterprint', cleanUp)
  window.print()
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

export function DisputeEvidence({
  evidence,
  provider,
}: {
  evidence: { readonly bg: string; readonly en: string }
  provider: string | null
}) {
  const t = useTranslations('tonight')
  const locale = useLocale()
  const own = locale === 'bg' ? evidence.bg : evidence.en
  const copyText = async (text: string) => {
    if (await copy(text)) toast(t('ev_copied'), { id: 'evidence-copied' })
  }
  return (
    <section className="space-y-2" data-testid="dispute-evidence">
      <h3 className="font-medium">{t('ev_title')}</h3>
      <p className="text-muted-foreground">
        {t('ev_note', { provider: provider ?? t('pb_provider_none') })}
      </p>
      <pre
        className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap [overflow-wrap:anywhere]"
        data-testid="dispute-evidence-text"
      >
        {own}
      </pre>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-12 whitespace-normal"
          onClick={() => void copyText(own)}
        >
          <CopyIcon aria-hidden className="size-4" />
          {t('ev_copy')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-12 whitespace-normal"
          onClick={() => void copyText(evidence.en)}
        >
          <CopyIcon aria-hidden className="size-4" />
          {t('ev_copy_en')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-12 whitespace-normal"
          onClick={() => printEvidence(own)}
        >
          <PrinterIcon aria-hidden className="size-4" />
          {t('ev_print')}
        </Button>
      </div>
    </section>
  )
}
