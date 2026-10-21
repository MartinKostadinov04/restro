// The service sheets as dialogs: the bag, the table bill, the waiter, the payment and the receipt
// page. They reuse the face's own `Overlay` (focus on the close button, Tab kept inside, the page
// behind kept from scrolling), and the provider closes them on Escape and with the phone's back
// button. Every sheet shows the small "Preview" marker while the state is demo data.

import { Overlay } from '../overlay'
import { BagSheet } from './bag-sheet'
import { BillSheet } from './bill-sheet'
import { CallSheet } from './call-sheet'
import { PreviewMarker } from './parts'
import { PaySheet } from './pay-sheet'
import { type Sheet, useServices } from './provider'
import { ReceiptPage } from './receipt-page'

export function ServiceSheets() {
  const o = useServices()
  if (o === null || o.sheet === null) return null
  const { sheet, words, guest, state } = o
  const titles: { readonly [S in Sheet]: string } = {
    bag: words.bag,
    tab: words.tab,
    call: words.callServer,
    pay: words.payTitle,
    receipt: words.receipt,
  }
  const detail = sheet === 'receipt'
  return (
    <Overlay
      key={sheet}
      title={titles[sheet]}
      closeLabel={detail ? guest.back : guest.close}
      onClose={o.closeSheet}
      detail={detail}
      leaving={o.leaving}
    >
      <PreviewMarker show={state.preview} words={words} />
      {sheet === 'bag' ? <BagSheet /> : null}
      {sheet === 'tab' ? <BillSheet /> : null}
      {sheet === 'call' ? <CallSheet /> : null}
      {sheet === 'pay' ? <PaySheet /> : null}
      {sheet === 'receipt' ? <ReceiptPage /> : null}
    </Overlay>
  )
}
