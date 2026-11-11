'use client'

// The plan editor's words (#397): a shape, a kind's symbol, and every refusal the plan commands and
// the database can answer, each in a sentence that says what to do next (copy rule: an error names
// the fix). Every refusal of the geometry has its own sentence, so the owner is never handed a bare
// "could not save" for a rule the screen could have named.
import type { SpotShape, SpotSymbol } from '@restro/core'
import { useTranslations } from 'next-intl'
import { useCallback } from 'react'

/** The refusals this screen words itself, by the code the action answers. */
export const PLAN_REFUSALS = [
  'shape_unknown',
  'shape_numbers',
  'shape_off_plan',
  'shape_not_square',
  'shape_not_turnable',
  'plan_refused',
  'plan_missing',
  'spot_name_taken',
  'spot_kind_missing',
  'spot_kind_in_use',
  'table_missing',
  'invalid_command',
] as const

type PlanRefusal = (typeof PLAN_REFUSALS)[number]

const isPlanRefusal = (code: string): code is PlanRefusal =>
  (PLAN_REFUSALS as readonly string[]).includes(code)

/** A sentence for a refusal of the plan's own, or undefined for the shared ones. */
export function usePlanRefusalWords() {
  const t = useTranslations('ownerSettings')
  return useCallback(
    (code: string): string | undefined => (isPlanRefusal(code) ? t(`pe_err.${code}`) : undefined),
    [t],
  )
}

/** A shape's name, as the owner picks it. */
export function useShapeWord() {
  const t = useTranslations('ownerSettings')
  return useCallback((shape: SpotShape): string => t(`pe_shape.${shape}`), [t])
}

/** A symbol's name, as the owner picks it for a kind. */
export function useSymbolWord() {
  const t = useTranslations('ownerSettings')
  return useCallback((symbol: SpotSymbol): string => t(`pe_symbol.${symbol}`), [t])
}
