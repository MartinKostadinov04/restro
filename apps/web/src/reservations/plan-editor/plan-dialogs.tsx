'use client'

// The plan editor's small dialogs (#397), the operational screens' pattern for adding a thing with
// up to three fields: a new spot (its name and kind), a plan's name, and a spot kind (its words,
// its symbol and its usual seats). Each is a form: Enter saves, the dialog closes when the save is
// sent, and the toast that follows says whether it was kept.
import { SPOT_NAME_MAX, SPOT_SYMBOLS, type SpotSymbol } from '@restro/core'
import { useTranslations } from 'next-intl'
import { type FormEvent, type ReactNode, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { WRAPS } from '@/lib/wrapping'

import { KindSymbol } from '../plan-shape'
import type { EditorKind } from './editor-types'
import { useSymbolWord } from './editor-words'

const LABEL_MAX = 40
const PLAN_NAME_MAX = 60
const MIN_SEATS = 1
const MAX_SEATS = 100

/** The frame every dialog here shares: a title, a line, the fields and two buttons. */
function FormDialog({
  title,
  line,
  testId,
  saveLabel,
  canSave,
  onSave,
  onClose,
  children,
}: {
  title: string
  line: string
  testId: string
  saveLabel: string
  canSave: boolean
  onSave: () => void
  onClose: () => void
  children: ReactNode
}) {
  const t = useTranslations('ownerSettings')
  function submit(event: FormEvent) {
    event.preventDefault()
    if (canSave) onSave()
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md" data-testid={testId}>
        <form method="post" onSubmit={submit} className="grid grid-cols-1 gap-4">
          <DialogHeader>
            <DialogTitle className="[overflow-wrap:anywhere]">{title}</DialogTitle>
            <DialogDescription>{line}</DialogDescription>
          </DialogHeader>
          {children}
          <DialogFooter>
            <Button type="button" variant="outline" className={WRAPS} onClick={onClose}>
              {t('st_cancel')}
            </Button>
            <Button
              type="submit"
              className={WRAPS}
              disabled={!canSave}
              data-testid={`${testId}-save`}
            >
              {saveLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** "New spot": what it is called and what kind it is. Where it goes is the editor's choice. */
export function NewSpotDialog({
  kinds,
  firstKind,
  nameFor,
  onSave,
  onClose,
}: {
  kinds: readonly EditorKind[]
  firstKind: string
  /** The first free name for a spot of a kind ("Маса 4"). */
  nameFor: (kind: EditorKind) => string
  onSave: (name: string, kind: EditorKind) => void
  onClose: () => void
}) {
  const t = useTranslations('ownerSettings')
  const start = kinds.find((one) => one.key === firstKind) ?? kinds[0]
  const [kindKey, setKindKey] = useState(start?.key ?? '')
  const [name, setName] = useState(start === undefined ? '' : nameFor(start))
  const [named, setNamed] = useState(false)
  const kind = kinds.find((one) => one.key === kindKey)
  const typed = name.trim()
  return (
    <FormDialog
      title={t('pe_new_spot_t')}
      line={t('pe_new_spot_d')}
      testId="pe-new-spot"
      saveLabel={t('pe_new_spot_do')}
      canSave={kind !== undefined && typed !== ''}
      onSave={() => kind !== undefined && onSave(typed, kind)}
      onClose={onClose}
    >
      <div className="grid grid-cols-1 gap-2">
        <Label htmlFor="pe-new-spot-kind">{t('pe_kind')}</Label>
        <Select
          value={kindKey}
          onValueChange={(key) => {
            setKindKey(key)
            const next = kinds.find((one) => one.key === key)
            // The name follows the kind until the person types one of their own.
            if (next !== undefined && !named) setName(nameFor(next))
          }}
        >
          <SelectTrigger id="pe-new-spot-kind" className="w-full" data-testid="pe-new-spot-kind">
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
      <div className="grid grid-cols-1 gap-2">
        <Label htmlFor="pe-new-spot-name">{t('pe_name')}</Label>
        <Input
          id="pe-new-spot-name"
          value={name}
          maxLength={SPOT_NAME_MAX}
          autoFocus
          data-testid="pe-new-spot-name"
          onChange={(event) => {
            setName(event.target.value)
            setNamed(true)
          }}
        />
      </div>
    </FormDialog>
  )
}

/** A plan's name. */
export function PlanNameDialog({
  saved,
  onSave,
  onClose,
}: {
  saved: string
  onSave: (name: string) => void
  onClose: () => void
}) {
  const t = useTranslations('ownerSettings')
  const [name, setName] = useState(saved)
  const typed = name.trim()
  return (
    <FormDialog
      title={t('pe_rename_t')}
      line={t('pe_rename_d')}
      testId="pe-rename"
      saveLabel={t('pe_save')}
      canSave={typed !== '' && typed !== saved}
      onSave={() => onSave(typed)}
      onClose={onClose}
    >
      <div className="grid grid-cols-1 gap-2">
        <Label htmlFor="pe-plan-name">{t('pe_plan_name')}</Label>
        <Input
          id="pe-plan-name"
          value={name}
          maxLength={PLAN_NAME_MAX}
          autoFocus
          data-testid="pe-plan-name"
          onChange={(event) => setName(event.target.value)}
        />
      </div>
    </FormDialog>
  )
}

/** What a kind is saved with. */
export interface KindFields {
  readonly label: string
  readonly symbol: SpotSymbol
  readonly defaultSeats: number | null
}

/** A spot kind, new (no `saved`) or changed: its words, its symbol, its usual seats. */
export function KindDialog({
  saved,
  onSave,
  onClose,
}: {
  saved: KindFields | null
  onSave: (kind: KindFields) => void
  onClose: () => void
}) {
  const t = useTranslations('ownerSettings')
  const symbolWord = useSymbolWord()
  const [label, setLabel] = useState(saved?.label ?? '')
  const [symbol, setSymbol] = useState<SpotSymbol>(saved?.symbol ?? 'table')
  const [seatsText, setSeatsText] = useState(
    saved?.defaultSeats == null ? '' : String(saved.defaultSeats),
  )
  const seatsTyped = seatsText.trim()
  const seats = seatsTyped === '' ? null : Number(seatsTyped)
  const seatsOk =
    seats === null || (Number.isInteger(seats) && seats >= MIN_SEATS && seats <= MAX_SEATS)
  const typed = label.trim()
  return (
    <FormDialog
      title={saved === null ? t('pe_kind_new_t') : t('pe_kind_edit_t')}
      line={t('pe_kind_d')}
      testId="pe-kind"
      saveLabel={saved === null ? t('pe_kind_new_do') : t('pe_save')}
      canSave={typed !== '' && seatsOk}
      onSave={() => onSave({ label: typed, symbol, defaultSeats: seats })}
      onClose={onClose}
    >
      <div className="grid grid-cols-1 gap-2">
        <Label htmlFor="pe-kind-label">{t('pe_kind_label')}</Label>
        <Input
          id="pe-kind-label"
          value={label}
          maxLength={LABEL_MAX}
          autoFocus
          placeholder={t('pe_kind_label_ph')}
          data-testid="pe-kind-label"
          onChange={(event) => setLabel(event.target.value)}
        />
      </div>
      <fieldset className="grid grid-cols-1 gap-2">
        <legend className="mb-2 text-sm font-medium">{t('pe_kind_symbol')}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SPOT_SYMBOLS.map((one) => (
            <Button
              key={one}
              type="button"
              variant={symbol === one ? 'default' : 'outline'}
              aria-pressed={symbol === one}
              className="min-h-11 justify-start"
              data-testid={`pe-kind-symbol-${one}`}
              onClick={() => setSymbol(one)}
            >
              <KindSymbol symbol={one} />
              {symbolWord(one)}
            </Button>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-1 gap-2">
        <Label htmlFor="pe-kind-seats">{t('pe_kind_seats')}</Label>
        <Input
          id="pe-kind-seats"
          className="w-24 max-w-full"
          inputMode="numeric"
          value={seatsText}
          placeholder="–"
          aria-invalid={seatsOk ? undefined : true}
          aria-describedby="pe-kind-seats-d"
          data-testid="pe-kind-seats"
          onChange={(event) => setSeatsText(event.target.value)}
        />
        <p
          id="pe-kind-seats-d"
          className={seatsOk ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'}
          role={seatsOk ? undefined : 'alert'}
        >
          {seatsOk ? t('pe_kind_seats_d') : t('pe_seats_bad', { min: MIN_SEATS, max: MAX_SEATS })}
        </p>
      </div>
    </FormDialog>
  )
}
