// The location sheet (D118, D119, D121, D122 §4; RR-48, RR-49): the host's `state.location.prompt`
// drawn as a dialog over whatever is open. It is no address of its own (`#bag`, `#tab`…): the host
// asks for it when an edit comes back `location_needed`, and the guest's own "Allow location" tap
// (`location.reopen`) asks for it again.
//
// - `consent`: D122's text ending with the Privacy link (`location.privacyUrl`), Allow
//   and Not now. Closing the sheet is not an answer: it only goes back (`dismiss`).
// - `checking`: "Checking your location…".
// - `failed`: Call a waiter where the venue takes calls (else the still card "Please order from
//   your waiter"), "Stop location check" and Cancel.
//
// "Stop location check" is also on the bill (bill-sheet.tsx). The face shows no position, pass or
// token: it only calls the host's controls (`binding.location`).

import { useEffect, useRef } from 'react'

import { Overlay } from '../overlay'
import { newActionId } from './command'
import { PreviewMarker, StatePanel } from './parts'
import { useServices } from './provider'

/** The stop control: one small button, only where the host can stop the check. */
export function StopLocationCheck() {
  const o = useServices()
  const stop = o?.binding.location?.stop
  if (o === null || stop === undefined) return null
  return (
    <button type="button" className="ro-ghost" data-slot="location.stop" onClick={() => stop()}>
      {o.words.locationStop}
    </button>
  )
}

export function LocationSheet() {
  const o = useServices()
  const controls = o?.binding.location
  const location = o?.state.location ?? null
  const prompt = controls === undefined || location === null ? 'none' : location.prompt
  const dismiss = controls?.dismiss
  // Escape goes back, as it does from every sheet.
  useEffect(() => {
    if (prompt === 'none' || dismiss === undefined) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prompt, dismiss])
  // Back from the location sheet, the focus goes to the close control of the sheet under it.
  const wasUp = useRef(false)
  const up = o !== null && controls !== undefined && location !== null && prompt !== 'none'
  useEffect(() => {
    if (wasUp.current && !up) {
      document
        .querySelector<HTMLElement>('.rm-overlay .rm-overlay-head button')
        ?.focus({ preventScroll: true })
    }
    wasUp.current = up
  }, [up])
  if (!up) return null
  const { words, guest, state } = o
  // The notice the consent text says the details sit behind (the location's own field: it is there
  // whatever paying is).
  const privacyUrl = location.privacyUrl ?? null
  const title =
    prompt === 'consent'
      ? words.locationAllowAgain
      : prompt === 'checking'
        ? words.locationChecking
        : words.locationFailed
  return (
    <Overlay key="location" title={title} closeLabel={guest.close} onClose={controls.dismiss}>
      <PreviewMarker show={state.preview} words={words} />
      {prompt === 'consent' ? (
        <div className="ro-sheet" data-slot="location.consent" data-location-prompt="consent">
          <p>
            {words.locationConsent(location.venueName)}
            {privacyUrl === null ? null : (
              <>
                {' '}
                <a href={privacyUrl} target="_blank" rel="noopener noreferrer">
                  {words.paying.legalPrivacyLink}
                </a>
              </>
            )}
          </p>
          <button
            type="button"
            className="ro-primary is-wide"
            data-design-part="button"
            onClick={() => void controls.allow()}
          >
            <span>{words.locationAllow}</span>
          </button>
          <button type="button" className="ro-ghost" onClick={() => controls.decline()}>
            {words.locationNotNow}
          </button>
        </div>
      ) : null}
      {prompt === 'checking' ? (
        <div data-location-prompt="checking">
          <StatePanel tone="wait" title={words.locationChecking} />
        </div>
      ) : null}
      {prompt === 'failed' ? (
        <div className="ro-sheet" data-slot="location.failed" data-location-prompt="failed">
          <StatePanel tone="bad" title={words.locationFailed} hint={words.locationWhy}>
            {o.features.callWaiter !== null ? (
              <button
                type="button"
                className="ro-primary"
                data-design-part="button"
                onClick={() => {
                  void o.run({
                    kind: 'service.request',
                    actionId: newActionId(),
                    request: 'waiter',
                    note: '',
                  })
                  controls.dismiss()
                }}
              >
                {words.locationCallWaiter}
              </button>
            ) : (
              <p className="ro-notice" data-slot="location.still-card" data-location-still-card="">
                {words.locationOrderFromWaiter}
              </p>
            )}
            <StopLocationCheck />
            <button type="button" className="ro-ghost" onClick={() => controls.dismiss()}>
              {words.locationCancel}
            </button>
          </StatePanel>
        </div>
      ) : null}
    </Overlay>
  )
}
