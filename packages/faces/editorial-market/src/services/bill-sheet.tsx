// The table bill sheet (`#tab`). It draws what the host has and nothing else (D72): the table's bill
// as the POS reads it (`state.tableBill`: its own lines and amounts, a line in a payment that is not
// final greyed "Being paid", "Left to pay", and how old the reading is), the rounds of the host's
// own record when it has one (`state.bill`: the guests' and the waiter's, with the host's status for
// each line), the lines already paid in the app, and Pay. The face never adds a round of its own (a
// round the guest just sent appears here when the host's state has it), and a guest round that the
// state lists twice is drawn once.

import { lineNameText, payMoney } from '@restro/shell'

import { Text } from '../parts'
import { distinctRounds, keyed } from './bill'
import { StopLocationCheck } from './location-sheet'
import { CallWaiter, PaidInApp } from './pay-sheet'
import { useServicesRequired } from './provider'

/** "×2" for a line of more than one. */
const mark = (quantity: string) => (quantity === '1' ? '' : ` ×${quantity}`)

export function BillSheet() {
  const o = useServicesRequired()
  const { words, state, locale, features } = o
  const w = words.paying
  const rounds = distinctRounds(state.bill)
  const bill = state.bill
  const table = state.tableBill ?? null
  const money = (minor: number) => payMoney(minor, table?.currency ?? 'EUR', locale)
  const paidLines = table?.paidLines ?? []
  // The POS's own lines are the bill where the host has no record of rounds (the guest page's host
  // has none); where it has, the rounds are the same lines with their status and who ordered them.
  const tableLines =
    rounds.length > 0
      ? []
      : (table?.parts.flatMap((part) => part.lines.map((line) => ({ part, line }))) ?? [])
  // What the table owes, as the host states it; nothing when the bill is empty or settled.
  const owed =
    table !== null && table.owedMinor > 0
      ? money(table.owedMinor)
      : bill !== null && bill.total.minor > 0
        ? bill.total.text
        : null
  // Without a location pass there is no bill: why, and the guest's own way to allow it (the pay
  // sheet says the same).
  if (state.location?.state === 'needed') {
    return (
      <div className="ro-sheet" data-slot="bill.hidden">
        <h3 className="ro-h">{w.locationTitle}</h3>
        <p>{w.locationBody}</p>
        {o.binding.location === undefined ? null : (
          <button
            type="button"
            className="ro-primary is-wide"
            data-design-part="button"
            onClick={() => o.binding.location?.reopen()}
          >
            <span>{w.allowLocation}</span>
          </button>
        )}
        <CallWaiter />
      </div>
    )
  }
  const empty = tableLines.length === 0 && rounds.length === 0 && paidLines.length === 0
  return (
    <div className="ro-sheet" data-design-part="bill">
      <p className="rm-overlay-intro">{words.tabIntro}</p>
      {table === null || rounds.length > 0 ? null : (
        <p className="ro-allergy" data-slot="bill.updated">
          {table.complete ? w.updated(table.readAgoSeconds) : w.stale(table.readAgoSeconds)}
        </p>
      )}
      {empty ? <p className="ro-empty">{table === null ? words.emptyTab : w.emptyBill}</p> : null}
      {tableLines.length === 0 ? null : (
        <>
          <ul className="ro-lines" data-slot="bill.lines" data-design-part="bill.lines">
            {tableLines.map(({ part, line }) => {
              const greyed = part.beingPaid || line.beingPaid
              return (
                <li key={line.id} data-being-paid={greyed ? '' : undefined}>
                  <span>
                    {lineNameText(line.name, locale, words.otherItem)}
                    {mark(line.quantity)} · {money(line.amountMinor)}
                    {greyed ? ` · ${w.beingPaid}` : ''}
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="ro-sum" data-slot="bill.owed">
            <span>{w.leftToPay}</span>
            <b>{money(table?.owedMinor ?? 0)}</b>
          </p>
        </>
      )}
      {rounds.length === 0 || bill === null ? null : (
        <>
          {rounds.map((round, index) => (
            <section key={round.id} className="ro-round" data-source={round.origin}>
              <header>
                <span>
                  {words.round} {index + 1} · {round.time}
                </span>
                <em>{round.origin === 'guest' ? words.fromApp : words.fromWaiter}</em>
              </header>
              <ul data-design-part="bill.lines">
                {round.lines.map((line) => (
                  <li key={line.id} data-status={line.status}>
                    <span className="ro-qty">{line.qty}×</span>
                    <span className="ro-tabname">
                      <Text value={line.name} page={locale} />
                      {line.options.length > 0 ? (
                        <small>
                          {keyed(line.options).map(({ key, text }, position) => (
                            <span key={key}>
                              {position > 0 ? ' · ' : ''}
                              <Text value={text} page={locale} />
                            </span>
                          ))}
                        </small>
                      ) : null}
                    </span>
                    <span className="ro-status" data-status={line.status}>
                      {words.lineStatus[line.status]}
                    </span>
                    <b>{line.total.text}</b>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div className="ro-sum is-big" data-design-part="bill.total">
            <span>{words.tableTotal}</span>
            <b>{bill.total.text}</b>
          </div>
        </>
      )}
      {table == null ? null : (
        // The lines paid in the app in this sitting stay on the bill, greyed (D127 1.2).
        <PaidInApp lines={paidLines} money={money} />
      )}
      {/* "Stop location check" (D119) sits on the bill while the phone holds a pass. */}
      {state.location?.state === 'held' ? <StopLocationCheck /> : null}
      {features.pay && owed !== null ? (
        <button
          type="button"
          className="ro-primary is-wide"
          data-design-part="button"
          onClick={(event) => o.openSheet('pay', event.currentTarget)}
        >
          <span>{words.pay}</span>
          <b>{owed}</b>
        </button>
      ) : null}
    </div>
  )
}
