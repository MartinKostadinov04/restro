// Sharing the bill by amount (D160 §3, #544): the guests of a table settle one bill together, each
// phone's card taking a part of it. "Split the amount" on the pay sheet starts it; this screen is
// what every phone of the table then sees — what is held of the shared amount, what is left, how
// long the share still has, and "Pay" for one's own part. It names no payer, ever (rule 3).
//
// The screens are the shell's (`shareScreen`): the share while it gathers, "Your part" with the
// amount field, "The rest" and the tip, the card form in the slot the page fills, and the endings.
// Nothing reads as paid before the server says so (D72): "Paid" is this phone's own part
// `captured`, and "The bill is paid" is the share itself `captured`.
//
// The QR code and the link under "Show the others" are the host's (`binding.shareInvite`): the face
// draws no code of its own and loads no library for one.

import {
  type Locale,
  lineNameText,
  NO_TIP,
  offersTakeBack,
  type PayingStrings,
  payMoney,
  refusalText,
  type ServiceStrings,
  SHARE_REST,
  type ShareBlock,
  type SharePartChoice,
  type ShareView,
  shareBlock,
  shareEndText,
  shareHoldCommand,
  shareMinutesLeft,
  sharePart,
  sharePartText,
  shareProgressText,
  shareScreen,
  shareTotals,
  type TipChoice,
} from '@restro/shell'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { newActionId } from './command'
import { StatePanel } from './parts'
import { CallWaiter, FormSlot, LegalBlock } from './pay-sheet'
import { useServicesRequired } from './provider'
import { TipRow } from './tip-row'

/** "×2" for a line of more than one. */
const mark = (quantity: string) => (quantity === '1' ? '' : ` ×${quantity}`)

/** Why Pay on "Your part" is greyed, in the guest's words; the amount field says the rest itself. */
function shareBlockText(
  block: ShareBlock | null,
  said: {
    readonly words: ServiceStrings
    readonly w: PayingStrings
    readonly share: ShareView
    readonly locale: Locale
  },
): string | null {
  const { words, w, share, locale } = said
  switch (block) {
    case null:
    // Nothing usable typed yet: the field itself shows it, so no line of words (as `bad_email`).
    case 'no_amount':
      return null
    case 'offline':
      return words.offline
    case 'cards_paused':
      return w.cardsPaused
    case 'share_over':
      return words.refusals.share_over
    case 'tip_too_big':
      return w.tipTooBig
    case 'above_share':
    case 'below_minimum':
    case 'rest_below_minimum':
      return sharePartText(w, block, share, locale)
  }
}

/** The QR code and the link the others use, under "Show the others" (D160 2.10). */
function Invite() {
  const o = useServicesRequired()
  const w = o.words.paying
  const invite = o.binding.shareInvite ?? null
  if (invite === null) return null
  return (
    <details className="ro-allergy" data-slot="share.invite">
      <summary>{w.share.showOthers}</summary>
      {invite.qrImage === null ? null : (
        <img
          src={invite.qrImage}
          alt=""
          width={160}
          height={160}
          data-slot="share.invite.qr"
          data-design-part="status"
        />
      )}
      <p>{w.share.invite}</p>
      <p data-slot="share.invite.link">{invite.url}</p>
    </details>
  )
}

/** The shared amount, what is held of it, what is left, and how long the share still has. */
function Progress({
  share,
  money,
}: {
  readonly share: ShareView
  readonly money: (minor: number) => string
}) {
  const o = useServicesRequired()
  const w = o.words.paying
  const [now, setNow] = useState(() => Date.now())
  // The minutes left are read from the share's own deadline, so a phone that sat on the screen for
  // a while never shows a stale "10 min left"; it never counts the share out by itself (D72).
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [])
  const minutes = shareMinutesLeft(share.endsAt, now)
  return (
    <>
      <p className="ro-sum" data-slot="share.progress">
        <span>{shareProgressText(w, share, o.locale)}</span>
        <b>{money(share.leftMinor)}</b>
      </p>
      {minutes === null ? null : (
        <p className="ro-allergy" data-slot="share.time">
          {w.share.minutesLeft(minutes)}
        </p>
      )}
      {share.lines.length === 0 ? null : (
        <ul className="ro-lines" data-slot="share.lines">
          {share.lines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a shared line has no id of its own
            <li key={index} data-being-paid="">
              {lineNameText(line.name, o.locale, o.words.otherItem)}
              {mark(line.quantity)} · {money(line.amountMinor)} · {w.beingPaid}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/**
 * One screen of a group payment. The screen changes under the guest's finger, so each new one takes
 * the focus itself, which keeps it inside the sheet and lets a screen reader read what it says.
 */
function Screen({
  kind,
  end,
  children,
}: {
  readonly kind: string
  readonly end?: string
  readonly children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the screen is a new one when its kind or end changes
  useEffect(() => {
    root.current?.focus({ preventScroll: true })
  }, [kind, end])
  return (
    <div
      className="ro-sheet"
      ref={root}
      tabIndex={-1}
      data-share-screen={kind}
      {...(end === undefined ? {} : { 'data-share-end': end })}
    >
      {children}
    </div>
  )
}

/** The table's group payment, from the share that is gathering to what became of this phone's part. */
export function ShareSheet({ share }: { readonly share: ShareView }) {
  const o = useServicesRequired()
  const { words, state, locale, run, binding } = o
  const w = words.paying
  const paying = state.paying ?? null
  const tipsOffered = state.ordering?.tips === true
  const money = (minor: number) => payMoney(minor, share.currency, locale)

  const [taking, setTaking] = useState(false)
  const [choice, setChoice] = useState<SharePartChoice>({ kind: 'amount', typed: '' })
  const [tip, setTip] = useState<TipChoice>(NO_TIP)
  const [other, setOther] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const screen = shareScreen(share)
  /** Sends a share command; a refusal is worded by code, a lost answer is never a success. */
  async function send(command: Parameters<typeof run>[0]) {
    setRefusal(null)
    setBusy(true)
    try {
      const outcome = await run(command)
      if (!alive.current) return
      if (!outcome.ok) {
        setRefusal(words.refusedOther)
        return
      }
      if (outcome.result.status === 'rejected') {
        setRefusal(
          refusalText(words, outcome.result.code, {
            command: command.kind,
            minCard: money(share.minimumMinor),
            left: money(share.leftMinor),
          }),
        )
      }
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const dismiss = () => {
    if (binding.shareControls === undefined) o.closeSheet()
    else binding.shareControls.dismiss()
  }
  const back = (
    <button type="button" className="ro-ghost" data-slot="share.back" onClick={dismiss}>
      {w.backToBill}
    </button>
  )
  const takeBack = offersTakeBack(share) ? (
    <button
      type="button"
      className="ro-ghost"
      data-slot="share.withdraw"
      disabled={busy}
      onClick={() => void send({ kind: 'share.withdraw', actionId: newActionId() })}
    >
      {w.share.takeBack}
    </button>
  ) : null
  const notice =
    refusal === null ? null : (
      <p className="ro-notice is-bad" role="alert" data-slot="share.refusal">
        {refusal}
      </p>
    )

  switch (screen.kind) {
    case 'open': {
      const part = sharePart(choice, share)
      const totals = shareTotals(choice, share, tip, tipsOffered)
      const block =
        paying === null
          ? null
          : shareBlock(share, choice, paying, tip, tipsOffered, state.offline === true)
      const blockWords = shareBlockText(block, { words, w, share, locale })
      return (
        <Screen kind="open">
          <h3 className="ro-h">{w.share.title}</h3>
          <Progress share={share} money={money} />
          {taking ? (
            <>
              <h4 className="ro-h">{w.share.partTitle}</h4>
              <div className="ro-row">
                <label className="ro-input">
                  <span>{w.share.amountLabel}</span>
                  <input
                    inputMode="decimal"
                    // "The rest" is a mode, not a number typed in: the field stays empty under it
                    // and the sum row below shows what the part comes to.
                    value={choice.kind === 'amount' ? choice.typed : ''}
                    data-slot="share.amount"
                    aria-invalid={part.kind === 'problem' || part.kind === 'bad'}
                    aria-describedby={blockWords === null ? undefined : 'ro-share-help'}
                    onChange={(event) => setChoice({ kind: 'amount', typed: event.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="ro-ghost"
                  data-slot="share.rest"
                  data-design-part="pay.scope"
                  aria-pressed={choice.kind === 'rest'}
                  onClick={() => setChoice(SHARE_REST)}
                >
                  {w.share.rest}
                </button>
              </div>
              {tipsOffered ? (
                <TipRow
                  tip={tip}
                  other={other}
                  totals={totals}
                  money={money}
                  onTip={setTip}
                  onOther={setOther}
                />
              ) : null}
              <div className="ro-sum">
                <span>{w.share.partTitle}</span>
                <b>{money(totals.itemsMinor)}</b>
              </div>
              {tipsOffered ? (
                <div className="ro-sum">
                  <span>{w.tip}</span>
                  <b>{money(totals.tipMinor)}</b>
                </div>
              ) : null}
              <div className="ro-sum is-big">
                <span>{w.total}</span>
                <b>{money(totals.totalMinor)}</b>
              </div>
              <p className="ro-allergy">{w.legalPrices}</p>
              {paying === null ? null : <LegalBlock paying={paying} w={w} />}
              <button
                type="button"
                className="ro-primary is-wide"
                data-design-part="button"
                data-slot="share.hold"
                disabled={block !== null || busy}
                onClick={() => {
                  const command = shareHoldCommand(newActionId(), share, choice, tip, tipsOffered)
                  if (command !== null) void send(command)
                }}
              >
                <span>{w.payX(money(totals.totalMinor))}</span>
              </button>
              {blockWords === null ? null : (
                <p className="ro-notice" role="status" id="ro-share-help" data-slot="share.blocked">
                  {blockWords}
                </p>
              )}
            </>
          ) : (
            <button
              type="button"
              className="ro-primary is-wide"
              data-design-part="button"
              data-slot="share.take"
              onClick={() => setTaking(true)}
            >
              <span>{w.share.partTitle}</span>
            </button>
          )}
          <Invite />
          {notice}
          {back}
        </Screen>
      )
    }
    case 'preparing':
    case 'card':
      return (
        <Screen kind={screen.kind}>
          <Progress share={share} money={money} />
          {screen.kind === 'preparing' || share.mine === null ? (
            <StatePanel tone="wait" title={w.preparing} />
          ) : (
            <>
              <div className="ro-sum is-big">
                <span>{w.total}</span>
                <b>{money(share.mine.amountMinor + share.mine.tipMinor)}</b>
              </div>
              <p className="ro-allergy">{w.legalPrices}</p>
              {paying === null ? null : <LegalBlock paying={paying} w={w} />}
              {binding.payForm === undefined ? null : (
                <FormSlot
                  slot={binding.payForm}
                  label={w.confirmX(money(share.mine.amountMinor + share.mine.tipMinor))}
                  locale={locale}
                  failedText={w.cardFormFailed}
                />
              )}
            </>
          )}
          {takeBack}
          {notice}
        </Screen>
      )
    case 'waiting':
      return (
        <Screen kind="waiting">
          <StatePanel tone="wait" title={w.share.waiting} />
          <Progress share={share} money={money} />
          <Invite />
          {takeBack}
          {notice}
        </Screen>
      )
    case 'releasing':
      return (
        <Screen kind="releasing">
          <StatePanel tone="wait" title={w.share.releasing} />
          {notice}
        </Screen>
      )
    case 'closing':
      return (
        <Screen kind="closing">
          <StatePanel tone="wait" title={w.share.closing} />
          <Progress share={share} money={money} />
        </Screen>
      )
    case 'paid':
      return (
        <Screen kind="paid">
          <StatePanel tone="ok" title={w.paid}>
            <p>{w.paidNumber}</p>
            <p className="ro-pay-number" data-slot="share.number">
              {share.number}
            </p>
            {share.mine === null ? null : (
              <div className="ro-sum is-big">
                <span>{w.total}</span>
                <b>{money(share.mine.amountMinor + share.mine.tipMinor)}</b>
              </div>
            )}
            <p data-slot="share.receipt.line">{w.paidReceipt}</p>
            {back}
          </StatePanel>
        </Screen>
      )
    case 'settled':
      return (
        <Screen kind="settled">
          <StatePanel tone="ok" title={w.share.settled}>
            {back}
          </StatePanel>
        </Screen>
      )
    case 'checking':
      return (
        <Screen kind="checking">
          <StatePanel tone="plain" title={w.checkingTitle} hint={w.checkingBody}>
            <CallWaiter />
            {back}
          </StatePanel>
        </Screen>
      )
    case 'ended':
      return (
        <Screen kind="ended" end={screen.end}>
          <StatePanel tone="bad" title={shareEndText(w, screen.end)}>
            {screen.again ? (
              <button
                type="button"
                className="ro-primary is-wide"
                data-design-part="button"
                data-slot="share.again"
                onClick={dismiss}
              >
                <span>{w.share.startAgain}</span>
              </button>
            ) : null}
            <CallWaiter />
            {back}
          </StatePanel>
        </Screen>
      )
  }
}
