'use client'

import type { FieldDefinition } from '@restro/core'
import { useTranslations } from 'next-intl'

/** `order_mode` stays readable even without a translation: `ask_waiter` becomes `Ask waiter`. */
function humanize(code: string): string {
  const spaced = code.replaceAll('_', ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * The interface label of an option code of an `enum` or `enum_set` field, from
 * `options.<field key>.<code>` in messages/*.json (the 14 EU allergens in BG and EN, the dietary
 * labels, the ordering modes). An option without a translation shows its code, humanised.
 */
export function useOptionLabel(definition: Pick<FieldDefinition, 'key'>): (code: string) => string {
  const t = useTranslations('options')
  return (code) => {
    const key = `${definition.key}.${code}`
    return t.has(key) ? t(key) : humanize(code)
  }
}
