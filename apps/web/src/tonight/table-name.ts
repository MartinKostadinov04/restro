'use client'

// A table's name as the screen words it: our name over it, else "Table 7" / «Маса 7» from its number.
import { useTranslations } from 'next-intl'

export function useTableName() {
  const t = useTranslations('tonight')
  return (label: string, numbered: boolean) => (numbered ? t('tb', { n: label }) : label)
}
