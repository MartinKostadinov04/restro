// The table bill sheet (`#tab`). It draws the host's `state.bill` and nothing else: every round,
// the guests' and the waiter's, with the host's status for each line and the host's total. The
// face never adds a round of its own (a round the guest just sent appears here when the host's
// state has it), and a guest round that the state lists twice is drawn once.

import { Text } from '../parts'
import { distinctRounds, keyed } from './bill'
import { useServicesRequired } from './provider'

export function BillSheet() {
  const o = useServicesRequired()
  const { words, state, locale, features } = o
  const rounds = distinctRounds(state.bill)
  const bill = state.bill
  // What the table owes, as the host states it; nothing when the bill is empty or settled.
  const owed = bill !== null && bill.total.minor > 0 ? bill.total : null
  return (
    <div className="ro-sheet">
      <p className="rm-overlay-intro">{words.tabIntro}</p>
      {rounds.length === 0 || bill === null ? (
        <p className="ro-empty">{words.emptyTab}</p>
      ) : (
        <>
          {rounds.map((round, index) => (
            <section key={round.id} className="ro-round" data-source={round.origin}>
              <header>
                <span>
                  {words.round} {index + 1} · {round.time}
                </span>
                <em>{round.origin === 'guest' ? words.fromApp : words.fromWaiter}</em>
              </header>
              <ul>
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
          <div className="ro-sum is-big">
            <span>{words.tableTotal}</span>
            <b>{bill.total.text}</b>
          </div>
        </>
      )}
      {features.pay && state.receipt !== null ? (
        <button
          type="button"
          className="ro-ghost"
          onClick={(event) => o.openSheet('receipt', event.currentTarget)}
        >
          {words.viewReceipt}
        </button>
      ) : null}
      {features.pay && owed !== null ? (
        <button
          type="button"
          className="ro-primary is-wide"
          onClick={(event) => o.openSheet('pay', event.currentTarget)}
        >
          <span>{words.pay}</span>
          <b>{owed.text}</b>
        </button>
      ) : null}
    </div>
  )
}
