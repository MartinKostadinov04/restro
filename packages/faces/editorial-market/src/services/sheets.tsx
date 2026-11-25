// The service sheets as dialogs: the bag, the table bill, the waiter and the payment, and the
// location sheet (location-sheet.tsx) over them when the host asks the guest about location. They reuse the face's own `Overlay` (focus on the close button, Tab kept inside, the page
// behind kept from scrolling), and the provider closes them on Escape and with the phone's back
// button. Every sheet shows the small "Preview" marker while the state is demo data, and, while the
// phone holds a location pass, "Stop location check" (D119, DA-9).

import { Overlay } from '../overlay'
import { BagSheet } from './bag-sheet'
import { BillSheet } from './bill-sheet'
import { CallSheet } from './call-sheet'
import { LocationSheet, StopLocationCheck } from './location-sheet'
import { PreviewMarker } from './parts'
import { PaySheet } from './pay-sheet'
import { type Sheet, useServices } from './provider'

export function ServiceSheets() {
  const o = useServices()
  if (o === null) return null
  // The location sheet sits over whatever is open, and shows alone when no service sheet is.
  if (o.sheet === null) return <LocationSheet />
  const { sheet, words, guest, state } = o
  const titles: { readonly [S in Sheet]: string } = {
    bag: words.bag,
    tab: words.tab,
    call: words.callServer,
    pay: words.payTitle,
  }
  return (
    <>
      <Overlay
        key={sheet}
        title={titles[sheet]}
        closeLabel={guest.close}
        onClose={o.closeSheet}
        leaving={o.leaving}
      >
        <PreviewMarker show={state.preview} words={words} />
        {sheet === 'bag' ? <BagSheet /> : null}
        {sheet === 'tab' ? <BillSheet /> : null}
        {sheet === 'call' ? <CallSheet /> : null}
        {sheet === 'pay' ? <PaySheet /> : null}
        {/* "Stop location check" (D119, DA-9; Martin 11-06): while the check is on, the stop is
            reachable from every service screen - the bag, the bill, Pay and Call a waiter -
            whatever the venue's Bill switch is, so the consent text's "You can stop anytime"
            holds even where no bill sheet exists. */}
        {state.location?.state === 'held' ? <StopLocationCheck /> : null}
      </Overlay>
      <LocationSheet />
    </>
  )
}
