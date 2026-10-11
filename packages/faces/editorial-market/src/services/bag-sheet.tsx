// The bag sheet (`#bag`): the guest's draft order. Names and prices are looked up in the current
// view model whenever it is drawn, so a price change or a sold-out dish shows at once; a line that
// can no longer be ordered is flagged and blocks sending until it is removed. The total is an
// estimate, labelled so; the bill that follows is the host's.
//
// "Send to kitchen" shows what the host says: pending, then accepted (the bag is spent and the bill
// opens) or rejected (the bag stays, with the host's reason). An error or a timeout keeps the bag
// and offers the same send again.

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
      {send.status === 'failed' ? (
        <div className="ro-notice is-bad" role="alert">
          <strong>{words.sendFailedTitle}</strong>
          <span>{words.sendFailedHint}</span>
        </div>
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
        disabled={pending || !resolved.canSend}
        onClick={o.sendBag}
      >
        {pending ? (
          <span>{words.sending}</span>
        ) : (
          <>
            <span>{send.status === 'failed' ? words.retry : words.sendToKitchen}</span>
            <b>
              {words.approx} {resolved.total.text}
            </b>
          </>
        )}
      </button>
    </div>
  )
}
