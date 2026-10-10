'use client'

// number, money, measurement and range.
import {
  type FieldValueOf,
  formatMoney,
  MEASUREMENT_UNITS,
  type MeasurementUnit,
} from '@restro/core'
import { useFormatter, useTranslations } from 'next-intl'
import { useState } from 'react'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { useFieldEnvironment } from '../environment'
import { moneyToInput, parseMoneyInput } from '../money-input'
import type { DisplayProps, EditorProps, FieldUi } from '../types'

function useUnitLabel() {
  const t = useTranslations('fields.units')
  return (unit: string) => (t.has(unit) ? t(unit) : unit)
}

// --- number ---------------------------------------------------------------------------------

function NumberDisplay({ definition, value }: DisplayProps<'number'>) {
  const format = useFormatter()
  return (
    <span className="text-foreground tabular-nums">
      {format.number(value, { maximumFractionDigits: 6 })}
      {definition.unit ? ` ${definition.unit}` : ''}
    </span>
  )
}

/** The number the text means (a comma works as decimal point), or `NaN` if it is not a number. */
function parseNumberText(text: string): number {
  const normalised = text.trim().replace(',', '.')
  if (!/^-?\d*\.?\d+$|^-?\d+\.?$/.test(normalised)) return Number.NaN
  return Number(normalised)
}

function NumberEditor({ definition, value, onChange, inputId, invalid }: EditorProps<'number'>) {
  const t = useTranslations('fields.hints')
  const [text, setText] = useState(value === undefined ? '' : String(value))
  const c = definition.constraints as { min?: number; max?: number; integer?: boolean }

  function change(next: string) {
    setText(next)
    // Not a number yet (`1.`, `-`): reported as NaN, which the number schema rejects, so Save
    // stays blocked until the text is a number.
    onChange(next.trim() === '' ? undefined : parseNumberText(next))
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          inputMode="decimal"
          value={text}
          aria-invalid={invalid || undefined}
          onChange={(event) => change(event.target.value)}
        />
        {definition.unit ? (
          <span className="text-sm text-muted-foreground">{definition.unit}</span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {c.integer ? `${t('integer')} ` : ''}
        {c.min !== undefined && c.max !== undefined
          ? t('between', { min: c.min, max: c.max })
          : c.min !== undefined
            ? t('atLeast', { min: c.min })
            : c.max !== undefined
              ? t('atMost', { max: c.max })
              : ''}
      </p>
    </div>
  )
}

export const number = { Display: NumberDisplay, Editor: NumberEditor } satisfies FieldUi<'number'>

// --- money ----------------------------------------------------------------------------------

function MoneyDisplay({ value }: DisplayProps<'money'>) {
  const environment = useFieldEnvironment()
  return (
    <span className="font-medium text-foreground tabular-nums">
      {formatMoney(value.amount_minor, value.currency, environment.locale)}
    </span>
  )
}

/**
 * The amount in major units (`12.50`), converted to integer minor units by core's money module.
 * What is typed is kept as text; only a complete, valid amount becomes a value.
 */
function MoneyEditor({ value, onChange, inputId, invalid }: EditorProps<'money'>) {
  const t = useTranslations('fields.hints')
  const environment = useFieldEnvironment()
  const [text, setText] = useState(() => moneyToInput(value))
  const parsed = parseMoneyInput(text, environment.currency)

  function change(next: string) {
    setText(next)
    const result = parseMoneyInput(next, environment.currency)
    // An amount that is not a price is reported as NaN minor units: `amount_minor` must be an
    // integer, so the money schema (check V2) rejects it and Save stays blocked.
    onChange(
      result === 'invalid' ? { amount_minor: Number.NaN, currency: environment.currency } : result,
    )
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          inputMode="decimal"
          placeholder="0.00"
          value={text}
          aria-invalid={invalid || parsed === 'invalid' || undefined}
          onChange={(event) => change(event.target.value)}
        />
        <span className="text-sm text-muted-foreground">{environment.currency}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {parsed !== undefined && parsed !== 'invalid'
          ? t('minorUnits', { minor: parsed.amount_minor })
          : t('moneyFormat')}
      </p>
    </div>
  )
}

export const money = { Display: MoneyDisplay, Editor: MoneyEditor } satisfies FieldUi<'money'>

// --- measurement ----------------------------------------------------------------------------

function MeasurementDisplay({ value }: DisplayProps<'measurement'>) {
  const format = useFormatter()
  const unitLabel = useUnitLabel()
  return (
    <span className="text-foreground tabular-nums">
      {format.number(value.value, { maximumFractionDigits: 6 })} {unitLabel(value.unit)}
    </span>
  )
}

function MeasurementEditor({
  definition,
  value,
  onChange,
  inputId,
  invalid,
}: EditorProps<'measurement'>) {
  const unitLabel = useUnitLabel()
  const allowed: readonly MeasurementUnit[] =
    (definition.constraints as { units?: MeasurementUnit[] }).units ?? MEASUREMENT_UNITS
  const [text, setText] = useState(value === undefined ? '' : String(value.value))
  const [unit, setUnit] = useState<MeasurementUnit>(value?.unit ?? allowed[0] ?? 'ml')

  function emit(nextText: string, nextUnit: MeasurementUnit) {
    onChange(
      nextText.trim() === ''
        ? undefined
        : ({
            value: parseNumberText(nextText),
            unit: nextUnit,
          } satisfies FieldValueOf<'measurement'>),
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        id={inputId}
        inputMode="decimal"
        value={text}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          setText(event.target.value)
          emit(event.target.value, unit)
        }}
      />
      <Select
        value={unit}
        onValueChange={(next) => {
          const chosen = allowed.find((candidate) => candidate === next)
          if (!chosen) return
          setUnit(chosen)
          emit(text, chosen)
        }}
      >
        <SelectTrigger className="w-28" aria-label={unitLabel(unit)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allowed.map((candidate) => (
            <SelectItem key={candidate} value={candidate}>
              {unitLabel(candidate)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export const measurement = {
  Display: MeasurementDisplay,
  Editor: MeasurementEditor,
} satisfies FieldUi<'measurement'>

// --- range (display only in Stage 1) --------------------------------------------------------

function RangeDisplay({ value }: DisplayProps<'range'>) {
  const format = useFormatter()
  const unitLabel = useUnitLabel()
  const suffix = value.unit ? ` ${unitLabel(value.unit)}` : ''
  return (
    <span className="text-foreground tabular-nums">
      {format.number(value.start)}–{format.number(value.end)}
      {suffix}
      {value.stops.length > 0 ? (
        <span className="text-muted-foreground">
          {' '}
          ({value.stops.map((stop) => format.number(stop)).join(', ')})
        </span>
      ) : null}
    </span>
  )
}

export { RangeDisplay }
