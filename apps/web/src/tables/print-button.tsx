'use client'

// "Print / Save as PDF" (brief S3-07): the browser's own print dialog. A PDF is made by choosing
// "Save as PDF" as the printer; no PDF library is involved.
import { PrinterIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'

export function PrintButton() {
  const t = useTranslations('tables.print')
  return (
    <Button type="button" onClick={() => window.print()} data-testid="print-button">
      <PrinterIcon aria-hidden />
      {t('button')}
    </Button>
  )
}
