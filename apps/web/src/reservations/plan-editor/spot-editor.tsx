'use client'

// One spot in the plan editor (#397): everything about it in one side sheet (a drawer on a phone),
// the operational screens' pattern for "everything about one thing". Each field saves on its own
// when it is left or Enter is pressed, with Undo in the toast; Escape puts the saved value back.
//
// The numbers (left, top, width, height, turn) are the alternative to dragging that WCAG 2.2 AA
// asks for (2.5.7): every place the canvas can make, these fields can make too, and they go
// through the same `fitPlace` so a typed number the database would refuse is fitted, not sent.
import {
  fitPlace,
  reshapePlace,
  SPOT_NAME_MAX,
  SPOT_SHAPES,
  type SpotPlace,
  type SpotShape,
  spotShapeOf,
} from '@restro/core'
import { useTranslations } from 'next-intl'
import { type ReactNode, useEffect, useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { WRAPS } from '@/lib/wrapping'

import { KindSymbol } from '../plan-shape'
import type { EditorKind, EditorSpot, EditorTable } from './editor-types'
import { useShapeWord } from './editor-words'

/** What one save of a spot changes. */
export interface SpotFields {
  readonly name: string
  readonly kind: string
  readonly place: SpotPlace
  readonly seats: number | null
  readonly tableId: string | null
}

/** The Select's value for "no Table": Radix gives an empty value no item. */
const NO_TABLE = 'none'
const MIN_SEATS = 1
const MAX_SEATS = 100

export function SpotEditor({
  spot,
  place,
  kinds,
  tables,
  busy,
  onSave,
  onRemove,
  onClose,
}: {
  spot: EditorSpot
  /** Where the spot is drawn now (a drag not yet answered included). */
  place: SpotPlace
  kinds: readonly EditorKind[]
  tables: readonly EditorTable[]
  busy: boolean
  /** Saves the changed fields; `done` is the toast's sentence. */
  onSave: (next: Partial<SpotFields>, done: string) => void
  onRemove: () => void
  onClose: () => void
}) {
  const t = useTranslations('ownerSettings')
  const shapeWord = useShapeWord()
  const isMobile = useIsMobile()
  const kind = kinds.find((one) => one.key === spot.kind) ?? null
  const turnable = spotShapeOf(place.shape)?.turnable ?? false
  const tableLabel = (table: EditorTable) =>
    table.numbered ? t('pe_table_n', { n: table.label }) : table.label

  const setPlace = (next: Partial<SpotPlace>) =>
    onSave({ place: fitPlace({ ...place, ...next }) }, t('pe_spot_saved'))

  const number = (text: string) => {
    const value = Number(text)
    return text !== '' && Number.isInteger(value) && value >= 0 ? value : undefined
  }

  const body = (
    <div className="grid grid-cols-1 gap-5 overflow-y-auto px-4 pb-2" data-testid="pe-spot-body">
      {spot.bookings > 0 ? (
        <p
          className="rounded-md border border-warning bg-warning/10 p-3 text-sm"
          data-testid="pe-spot-booked"
        >
          {t('pe_spot_booked', { n: spot.bookings })}
        </p>
      ) : null}

      <CommitInput
        label={t('pe_name')}
        saved={spot.name}
        maxLength={SPOT_NAME_MAX}
        problem={t('pe_name_bad')}
        testId="pe-spot-name"
        parse={(text) => (text === '' ? undefined : text)}
        onCommit={(name) => onSave({ name }, t('pe_spot_saved'))}
      />

      <div className="grid grid-cols-1 gap-2">
        <Label htmlFor="pe-spot-kind">{t('pe_kind')}</Label>
        <Select
          value={spot.kind}
          disabled={busy}
          onValueChange={(key) => onSave({ kind: key }, t('pe_spot_saved'))}
        >
          <SelectTrigger id="pe-spot-kind" className="w-full" data-testid="pe-spot-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {kinds.map((one) => (
              <SelectItem key={one.key} value={one.key}>
                <KindSymbol symbol={one.symbol} />
                {one.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <fieldset className="grid grid-cols-1 gap-2">
        <legend className="mb-2 text-sm font-medium">{t('pe_shape_h')}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SPOT_SHAPES.map((shape: SpotShape) => (
            <Button
              key={shape}
              type="button"
              variant={place.shape === shape ? 'default' : 'outline'}
              aria-pressed={place.shape === shape}
              disabled={busy}
              className="min-h-11"
              data-testid={`pe-shape-${shape}`}
              onClick={() => {
                if (place.shape === shape) return
                onSave({ place: reshapePlace(place, shape) }, t('pe_spot_saved'))
              }}
            >
              {shapeWord(shape)}
            </Button>
          ))}
        </div>
      </fieldset>

      <CommitInput
        label={t('pe_seats')}
        description={
          kind?.defaultSeats == null
            ? t('pe_seats_d_none')
            : t('pe_seats_d', { n: kind.defaultSeats })
        }
        saved={spot.seats === null ? '' : String(spot.seats)}
        placeholder={kind?.defaultSeats == null ? '–' : String(kind.defaultSeats)}
        inputMode="numeric"
        problem={t('pe_seats_bad', { min: MIN_SEATS, max: MAX_SEATS })}
        testId="pe-spot-seats"
        parse={(text) => {
          if (text === '') return null
          const seats = Number(text)
          return Number.isInteger(seats) && seats >= MIN_SEATS && seats <= MAX_SEATS
            ? seats
            : undefined
        }}
        onCommit={(seats) => onSave({ seats }, t('pe_spot_saved'))}
      />

      <div className="grid grid-cols-1 gap-2">
        <Label htmlFor="pe-spot-table">{t('pe_table')}</Label>
        {tables.length === 0 && spot.tableId === null ? (
          <p className="text-sm text-muted-foreground" data-testid="pe-spot-no-tables">
            {t('pe_table_none_yet')}
          </p>
        ) : (
          <>
            <Select
              value={spot.tableId ?? NO_TABLE}
              disabled={busy}
              onValueChange={(value) =>
                onSave({ tableId: value === NO_TABLE ? null : value }, t('pe_spot_saved'))
              }
            >
              <SelectTrigger id="pe-spot-table" className="w-full" data-testid="pe-spot-table">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TABLE}>{t('pe_table_none')}</SelectItem>
                {tables.map((table) => (
                  <SelectItem key={table.id} value={table.id}>
                    {tableLabel(table)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">{t('pe_table_d')}</p>
          </>
        )}
      </div>

      <fieldset className="grid grid-cols-1 gap-2">
        <legend className="mb-1 text-sm font-medium">{t('pe_place')}</legend>
        <p className="text-sm text-muted-foreground">{t('pe_place_d')}</p>
        <div className="grid grid-cols-2 gap-3">
          <CommitInput
            label={t('pe_x')}
            saved={String(place.x)}
            inputMode="numeric"
            problem={t('pe_number_bad')}
            testId="pe-spot-x"
            parse={number}
            onCommit={(x) => setPlace({ x })}
          />
          <CommitInput
            label={t('pe_y')}
            saved={String(place.y)}
            inputMode="numeric"
            problem={t('pe_number_bad')}
            testId="pe-spot-y"
            parse={number}
            onCommit={(y) => setPlace({ y })}
          />
          <CommitInput
            label={t('pe_w')}
            saved={String(place.width)}
            inputMode="numeric"
            problem={t('pe_number_bad')}
            testId="pe-spot-w"
            parse={number}
            onCommit={(width) => setPlace({ width })}
          />
          <CommitInput
            label={t('pe_h')}
            saved={String(place.height)}
            inputMode="numeric"
            problem={t('pe_number_bad')}
            testId="pe-spot-h"
            parse={number}
            onCommit={(height) => setPlace({ height })}
          />
          {turnable ? (
            <CommitInput
              label={t('pe_turn')}
              saved={String(place.rotation)}
              inputMode="numeric"
              problem={t('pe_turn_bad')}
              testId="pe-spot-turn"
              parse={(text) => {
                const turn = number(text)
                return turn !== undefined && turn < 360 ? turn : undefined
              }}
              onCommit={(rotation) => setPlace({ rotation })}
            />
          ) : null}
        </div>
      </fieldset>
    </div>
  )

  const buttons = (
    <>
      <Button
        type="button"
        variant="outline"
        className={WRAPS}
        disabled={busy}
        data-testid="pe-spot-remove"
        onClick={onRemove}
      >
        {t('pe_spot_remove')}
      </Button>
      <Button type="button" className={WRAPS} data-testid="pe-spot-done" onClick={onClose}>
        {t('pe_done')}
      </Button>
    </>
  )
  const sub = kind?.label ?? spot.kind

  return isMobile ? (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent data-testid="pe-spot-sheet">
        <DrawerHeader>
          <DrawerTitle className="[overflow-wrap:anywhere]">{spot.name}</DrawerTitle>
          <DrawerDescription>{sub}</DrawerDescription>
        </DrawerHeader>
        {body}
        <DrawerFooter>{buttons}</DrawerFooter>
      </DrawerContent>
    </Drawer>
  ) : (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-md" data-testid="pe-spot-sheet">
        <SheetHeader>
          <SheetTitle className="[overflow-wrap:anywhere]">{spot.name}</SheetTitle>
          <SheetDescription>{sub}</SheetDescription>
        </SheetHeader>
        {body}
        <SheetFooter>{buttons}</SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/**
 * A value typed in place: saved when the field is left or Enter is pressed, put back by Escape.
 * `parse` answers undefined for a value that cannot be saved: it stays, with its problem shown.
 */
function CommitInput<T>({
  label,
  description,
  saved,
  placeholder,
  maxLength,
  inputMode,
  problem,
  testId,
  parse,
  onCommit,
}: {
  label: string
  description?: ReactNode
  saved: string
  placeholder?: string
  maxLength?: number
  inputMode?: 'numeric'
  problem: string
  testId: string
  parse: (text: string) => T | undefined
  onCommit: (value: T) => void
}) {
  const id = useId()
  const [text, setText] = useState(saved)
  const [wrong, setWrong] = useState(false)
  useEffect(() => {
    setText(saved)
    setWrong(false)
  }, [saved])

  function commit() {
    const typed = text.trim()
    if (typed === saved) {
      setWrong(false)
      return
    }
    const value = parse(typed)
    if (value === undefined) {
      setWrong(true)
      return
    }
    setWrong(false)
    onCommit(value)
  }

  return (
    <div className="grid grid-cols-1 gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={text}
        placeholder={placeholder}
        maxLength={maxLength}
        inputMode={inputMode}
        aria-invalid={wrong ? true : undefined}
        aria-describedby={wrong ? `${id}-problem` : undefined}
        data-testid={testId}
        onChange={(event) => {
          setText(event.target.value)
          setWrong(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') {
            setText(saved)
            setWrong(false)
          }
        }}
        onBlur={commit}
      />
      {description === undefined ? null : (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      {wrong ? (
        <p id={`${id}-problem`} className="text-sm text-destructive" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  )
}
