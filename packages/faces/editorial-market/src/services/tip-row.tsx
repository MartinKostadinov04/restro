// The tip row (D127 1.3): "Tip: goes to the venue" with 5, 10 and 15 % of the chosen lines and
// "Other amount", nothing selected to start with, and a tap on the chosen one clears it. It is the
// same row on the pay sheet and on the order screen above "Send and pay" (#258), so it lives once.
// The row is controlled: the choice and the typed amount belong to the screen that draws it, which
// keeps them while the row is away. The amounts are the shell's preview of the chosen lines
// (`payTotalsOf`); the hold is priced by the server.

import { NO_TIP, type PayTotals, parseMinor, TIP_PERCENTS, type TipChoice } from '@restro/shell'

import { useServicesRequired } from './provider'

export function TipRow({
  tip,
  other,
  totals,
  money,
  onTip,
  onOther,
}: {
  readonly tip: TipChoice
  /** The text typed in "Other amount". */
  readonly other: string
  readonly totals: PayTotals
  /** An amount of the screen as text in its currency. */
  readonly money: (minor: number) => string
  readonly onTip: (next: TipChoice) => void
  readonly onOther: (text: string) => void
}) {
  const o = useServicesRequired()
  const w = o.words.paying
  // The Pay page's Tip (D130): chips, or rows that also show what each percent comes to. The amounts
  // are the shell's preview of the ticked lines, and none shows before a line is ticked.
  const rows = o.view.design.pay?.tip === 'rows'
  const amount = (percent: number): string | null => {
    const preset = totals.presets.find((candidate) => candidate.percent === percent)
    return preset === undefined || totals.itemsMinor <= 0 ? null : money(preset.tipMinor)
  }
  const pick = (next: TipChoice) =>
    onTip(
      tip.kind === next.kind &&
        (next.kind !== 'percent' || (tip.kind === 'percent' && tip.percent === next.percent))
        ? NO_TIP
        : next,
    )
  return (
    <fieldset className="ro-tips" data-slot="pay.tip.row" data-design-part="pay.tip">
      <legend>{w.tipLabel}</legend>
      {TIP_PERCENTS.map((percent) => (
        <button
          key={percent}
          type="button"
          className="ro-ghost"
          data-slot="pay.tip.preset"
          aria-pressed={tip.kind === 'percent' && tip.percent === percent}
          onClick={() => pick({ kind: 'percent', percent })}
        >
          {rows && amount(percent) !== null ? (
            <>
              <span>{`${percent} %`}</span>
              <span className="ro-tip-amount">{amount(percent)}</span>
            </>
          ) : (
            `${percent} %`
          )}
        </button>
      ))}
      <label className="ro-input">
        <span>{w.tipOther}</span>
        <input
          inputMode="decimal"
          value={other}
          data-slot="pay.tip.other"
          aria-invalid={other.trim() !== '' && parseMinor(other) === null}
          onChange={(event) => {
            onOther(event.target.value)
            const minor = parseMinor(event.target.value)
            onTip(minor === null ? NO_TIP : { kind: 'other', minor })
          }}
        />
      </label>
    </fieldset>
  )
}
