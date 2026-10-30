// The bag sheet (`#bag`): the guest's draft order. Names and prices are looked up in the current
// view model whenever it is drawn, so a price change or a sold-out dish shows at once; a line that
// can no longer be ordered is flagged and blocks sending until it is removed. The total is an
// estimate, labelled so; the bill that follows is the host's.
//
// "Send to kitchen" shows what the host says: pending, then accepted (the bag is spent and the bill
// opens) or rejected (the bag stays, with the host's reason). An error, a timeout or a lost answer
// keeps the bag and says D120's line (call a waiter, with the reference where there is one): the
// order may already be in the POS, so there is no "Try again" and no re-send for a few minutes.
// While the phone is offline Send is greyed with the weak-connection line (D121).

import { Text } from '../parts'
import { StatePanel, Stepper } from './parts'
import { useServicesRequired } from './provider'

export function BagSheet() {
  const o = useServicesRequired()
  const { words, resolved, send, locale } = o

  if (send.status === 'sent') {
    return (
      <StatePanel
        tone="ok"
        title={words.sent}
        hint={send.ref === null ? words.sentHint : `${words.sentHint} ${words.reference(send.ref)}`}
      >
        <button type="button" className="ro-ghost" onClick={o.closeSheet}>
          {words.done}
        </button>
      </StatePanel>
    )
  }
  if (resolved.lines.length === 0) return <p className="ro-empty">{words.emptyBag}</p>

  const pending = send.status === 'pending'
  const offline = o.state.offline === true
  // A Send whose answer was lost (this face's, or the host's own word for it): D120's line in place
  // of the weak-signal line, with the reference where the host has one, and no re-send offered.
  const lost = send.status === 'failed' || o.state.sendLost != null
  const lostRef = o.state.sendLost?.ref ?? null
  return (
    <div className="ro-sheet" aria-busy={pending}>
      <ul className="ro-lines">
        {resolved.lines.map((entry) => {
          const name = entry.item === null ? words.unavailableLine : entry.item.name.text
          return (
            <li key={entry.line.key} data-available={entry.available ? 'true' : 'false'}>
              <div className="ro-line-main">
                <strong>
                  {entry.item === null ? name : <Text value={entry.item.name} page={locale} />}
                </strong>
                {entry.options.length > 0 ? (
                  <small>
                    {entry.options.map((option, index) => (
                      <span key={option.id}>
                        {index > 0 ? ' · ' : ''}
                        <Text value={option.name} page={locale} />
                      </span>
                    ))}
                  </small>
                ) : null}
                {entry.line.note === '' ? null : <small>“{entry.line.note}”</small>}
                {!entry.available && entry.item !== null ? (
                  <small className="ro-flag">{words.unavailableLine}</small>
                ) : null}
                <div className="ro-line-actions">
                  {entry.available ? (
                    <button
                      type="button"
                      aria-label={`${words.edit}: ${name}`}
                      disabled={pending}
                      onClick={(event) => o.edit(entry.line, event.currentTarget)}
                    >
                      {words.edit}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`${words.remove}: ${name}`}
                    disabled={pending}
                    onClick={() => o.editBag({ type: 'remove', key: entry.line.key })}
                  >
                    {words.remove}
                  </button>
                </div>
              </div>
              <div className="ro-line-side">
                {entry.total === null ? null : <b>{entry.total.text}</b>}
                {entry.available ? (
                  <Stepper
                    size="sm"
                    disabled={pending}
                    value={entry.line.qty}
                    label={name}
                    words={words}
                    onChange={(qty) =>
                      o.editBag({ type: 'qty', key: entry.line.key, delta: qty - entry.line.qty })
                    }
                  />
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
      <div className="ro-sum">
        <span>{words.estimateTotal}</span>
        <b>{resolved.total.text}</b>
      </div>

      {resolved.canSend ? null : (
        <p className="ro-notice is-bad" role="alert">
          {words.unavailableHint}
        </p>
      )}
      {lost ? (
        <div className="ro-notice is-bad" role="alert" data-slot="send.lost">
          <span>{words.sendLost}</span>
          {lostRef === null ? null : <small>{words.reference(lostRef)}</small>}
        </div>
      ) : offline ? (
        <p className="ro-notice" role="status" data-slot="send.offline">
          {words.offline}
        </p>
      ) : null}
      {send.status === 'rejected' ? (
        <div className="ro-notice is-bad" role="alert">
          <strong>{words.sendRejectedTitle}</strong>
          {send.message === null ? (
            <span>{words.sendRejectedHint}</span>
          ) : (
            <Text value={send.message} page={locale} />
          )}
          {send.ref === null ? null : <small>{words.reference(send.ref)}</small>}
        </div>
      ) : null}
      {send.status === 'pending' && send.received ? (
        <p className="ro-notice" role="status">
          {words.sendReceived}
        </p>
      ) : null}

      <button
        type="button"
        className="ro-primary is-wide"
        disabled={pending || !resolved.canSend || offline || lost}
        onClick={o.sendBag}
      >
        {pending ? (
          <span>{words.sending}</span>
        ) : (
          <>
            <span>{words.sendToKitchen}</span>
            <b>
              {words.approx} {resolved.total.text}
            </b>
          </>
        )}
      </button>
    </div>
  )
}
