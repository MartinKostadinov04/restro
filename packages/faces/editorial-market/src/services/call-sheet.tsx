// The "call a waiter" sheet (`#call`). The guest picks one of the kinds the venue allows
// (`view.features.callWaiter.kinds`) and sends it; there is no note (#180). After that the
// sheet shows only what the host says: the table's own call from `state.requests`. A waiter is
// "on the way" only when the host's call says `on_the_way`; until the host's state has the call,
// the sheet says it was sent and is waiting.
//
// One open call per table (D127): the host lists one request per kind, all carrying the call's own
// id, so the sheet draws them as one call ("Ice, Water") and the way on from an open call is
// another kind, which the host adds to the same call. There is no withdrawing a call: the guide
// says so and the host refuses `service.cancel`, so the sheet offers no Cancel (DA-10).
//
// A call nobody answered in the venue's time comes back `rejected`, and the sheet still speaks
// about it when the guest opens the sheet again (the host keeps it a few minutes), so a lapsed call
// reads as "Ask your waiter" rather than as a sheet where nothing ever happened (DA-27).
//
// A call that staff mark handled while the guest watches it in the sheet reads "Your call was
// handled" until the guest moves on (#344). One the sheet did not see open - a handled call met on
// opening - is never drawn: the picker shows and a new call is possible.
//
// No local success (D72): an answer that was lost (`pending` with `answer_lost`, the host's own
// answer when the request threw, timed out or came back unusable) is never "Request sent". It says
// D120's lost-answer line, and "Try again" is safe here because the retry carries the same action
// id and a repeat of a kind changes nothing (D127).

import {
  callIsSingleStep,
  type RequestStatus,
  type RequestView,
  refusalText,
  type ServiceKind,
  type ViewText,
} from '@restro/shell'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { BellIcon, CardIcon, DropletsIcon, HandIcon, ReceiptIcon, UtensilsIcon } from '../icons'
import { Text } from '../parts'
import { ChoiceGroup } from './choice'
import { newActionId, type Outcome } from './command'
import { type PanelTone, StatePanel } from './parts'
import { useServicesRequired } from './provider'

/** The icon of each kind. */
const KIND_ICONS: { readonly [K in ServiceKind]: () => ReactNode } = {
  waiter: () => <BellIcon />,
  bill: () => <ReceiptIcon />,
  terminal: () => <CardIcon />,
  ice: () => <DropletsIcon />,
  water: () => <DropletsIcon />,
  glasses: () => <UtensilsIcon />,
  clean_table: () => <HandIcon />,
}

/** The statuses of a call that is still open: another kind joins it (D127). */
const OPEN: readonly RequestStatus[] = ['sent', 'accepted', 'on_the_way']

/** The statuses the sheet still speaks about: an open call, and one nobody answered (DA-27). */
const SHOWN: readonly RequestStatus[] = [...OPEN, 'rejected']

/** How each status looks. */
const TONES: { readonly [S in RequestStatus]: PanelTone } = {
  sent: 'wait',
  accepted: 'pulse',
  on_the_way: 'pulse',
  done: 'ok',
  cancelled: 'plain',
  rejected: 'bad',
}

/** The request the guest has just sent, before the host's state lists it. */
interface Asked {
  readonly actionId: string
  readonly phase: 'sending' | 'sent' | 'lost' | 'failed' | 'rejected'
  readonly message: ViewText | null
  /** Why the host refused it (`rejected` only), to word when it gave no message. */
  readonly code?: string | null
}

/**
 * One call of the table, as the host's requests describe it: every request of a call carries the
 * call's own id as its action id and the call's status (#180), so they are one thing on screen.
 */
interface TableCall {
  readonly id: string
  readonly kinds: readonly ServiceKind[]
  readonly status: RequestStatus
}

/** The host's requests gathered into the calls they belong to, oldest call first. */
function callsOf(requests: readonly RequestView[]): TableCall[] {
  const calls: TableCall[] = []
  for (const request of requests) {
    const at = calls.findIndex((call) => call.id === request.actionId)
    const found = at === -1 ? undefined : calls[at]
    if (found === undefined) {
      calls.push({ id: request.actionId, kinds: [request.kind], status: request.status })
    } else {
      calls[at] = { ...found, kinds: [...found.kinds, request.kind] }
    }
  }
  return calls
}

/** The phases of one waiter call sent from a button: `lost` is an answer that never came (D120). */
export type CallPhase = 'idle' | 'sending' | 'sent' | 'lost' | 'failed'

/**
 * One "Call a waiter" button's own call and what became of it (D72: no local success). The screens
 * of paying, the bill without a location pass and the failed location check each offer one button;
 * every one of them shows pending, then the host's word, and never calls a lost answer a success
 * (DA-5). `call()` answers true only for a call the host took.
 */
export function useWaiterCall(kind: ServiceKind = 'waiter'): {
  readonly phase: CallPhase
  readonly busy: boolean
  readonly notice: ReactNode
  readonly call: () => Promise<boolean>
} {
  const o = useServicesRequired()
  const { words } = o
  const [phase, setPhase] = useState<CallPhase>('idle')
  const [refused, setRefused] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  // Sending, sent and lost all keep the button out of reach: the request may be with the staff.
  const busy = phase === 'sending' || phase === 'sent' || phase === 'lost'
  async function call(): Promise<boolean> {
    if (busy) return false
    setPhase('sending')
    setRefused(null)
    let outcome: Outcome = { ok: false }
    try {
      outcome = await o.run({
        kind: 'service.request',
        actionId: newActionId(),
        request: kind,
        note: '',
      })
    } catch {
      outcome = { ok: false }
    }
    if (!alive.current) return false
    if (!outcome.ok) {
      setPhase('failed')
      return false
    }
    if (outcome.result.status === 'pending') {
      setPhase('lost')
      return false
    }
    if (outcome.result.status === 'rejected') {
      setPhase('failed')
      setRefused(refusalText(words, outcome.result.code, { command: 'service.request' }))
      return false
    }
    setPhase('sent')
    return true
  }
  const notice =
    phase === 'sending' ? (
      <small role="status">{words.requesting}</small>
    ) : phase === 'sent' ? (
      <small role="status">{words.requestStates.sent.title}</small>
    ) : phase === 'lost' ? (
      <small role="alert">{words.callLost}</small>
    ) : phase === 'failed' ? (
      <small role="alert">{refused ?? words.requestFailed}</small>
    ) : null
  return { phase, busy, notice, call }
}

export function CallSheet() {
  const o = useServicesRequired()
  const { words, state, locale } = o
  const kinds = o.features.callWaiter?.kinds ?? []

  const [kind, setKind] = useState<ServiceKind | null>(null)
  const [asked, setAsked] = useState<Asked | null>(null)
  // Calls the guest has moved on from ("send another request"), by the host's call id.
  const [movedOn, setMovedOn] = useState<ReadonlySet<string>>(new Set())
  // The guest asked for something else while a call is open: the picker over the open call (D127).
  const [picking, setPicking] = useState(false)
  const attempt = useRef<{ readonly key: string; readonly actionId: string } | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // The calls this sheet has seen open: only a call the guest followed gets the handled panel when
  // staff answer it (#344). An old handled call, met on opening, never does. This state lives and
  // dies with the sheet (it is unmounted on close), which is what "until the guest closes it" rests on.
  const [followed, setFollowed] = useState<ReadonlySet<string>>(new Set())
  const openIds = callsOf(state.requests)
    .filter((call) => OPEN.includes(call.status))
    .map((call) => call.id)
  const openKey = openIds.join(' ')
  // biome-ignore lint/correctness/useExhaustiveDependencies: `openKey` is `openIds` as one string, so the effect runs exactly when the open ids change
  useEffect(() => {
    setFollowed((now) => (openIds.every((id) => now.has(id)) ? now : new Set([...now, ...openIds])))
  }, [openKey])

  /** A call staff handled while the guest watched it: followed from open, or sent from this sheet
   * (which covers one the host first lists already `done`, between two of its polls). */
  const handledWhileWatched = (call: TableCall) =>
    call.status === 'done' && (followed.has(call.id) || asked?.actionId === call.id)

  // The call this sheet is about: the table's latest one the guest has not moved on from, open or
  // lapsed, or handled while the guest watched it. The host lists only the table's latest call, and
  // drops it a few minutes after it ended.
  const current = [...callsOf(state.requests)]
    .reverse()
    .find(
      (call) => !movedOn.has(call.id) && (SHOWN.includes(call.status) || handledWhileWatched(call)),
    )
  const openNow = current !== undefined && OPEN.includes(current.status)

  // With only `waiter` ticked there is nothing to choose (D127): the kinds are read as they stand,
  // and the tap on the waiter button that opened the sheet has already called.
  const single = callIsSingleStep(o.features.callWaiter)
  const picked: ServiceKind | null = kind !== null && kinds.includes(kind) ? kind : null
  const chosen: ServiceKind | null = single ? 'waiter' : picked
  const ready = chosen !== null

  async function send() {
    if (chosen === null || !ready) return
    const key = chosen
    // The same request again (a retry) is the same action; a different one is new.
    const actionId = attempt.current?.key === key ? attempt.current.actionId : newActionId()
    attempt.current = { key, actionId }
    setPicking(false)
    // A call that ended has had its say: this one takes the screen (its own kind joins an open one).
    if (current !== undefined && !OPEN.includes(current.status)) {
      const ended = current.id
      setMovedOn((now) => new Set([...now, ended]))
    }
    setAsked({ actionId, phase: 'sending', message: null })
    let outcome: Outcome = { ok: false }
    try {
      outcome = await o.run({ kind: 'service.request', actionId, request: chosen, note: '' })
    } catch {
      outcome = { ok: false }
    }
    if (!alive.current) return
    const settle = (phase: Asked['phase'], message: ViewText | null, code: string | null = null) =>
      setAsked((now) => (now?.actionId === actionId ? { actionId, phase, message, code } : now))
    if (!outcome.ok) {
      settle('failed', null) // the request may or may not have gone: a retry reuses the actionId
    } else if (outcome.result.status === 'pending') {
      // The host lost the answer: never "Request sent" (D72). The retry carries the same action id.
      settle('lost', null)
    } else if (outcome.result.status === 'rejected') {
      attempt.current = null
      settle('rejected', outcome.result.message, outcome.result.code ?? null)
    } else {
      attempt.current = null
      settle('sent', null)
    }
  }

  // The single step calls once, as the sheet opens from the tap that armed it. A sheet that opens
  // from an address (a reload) or with a call already open sends nothing; a lapsed call does not
  // stand in the way of the tap, which is the guest asking for a waiter now.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as the sheet opens
  useEffect(() => {
    if (single && o.takeCall() && !openNow && asked === null) void send()
  }, [])

  /** The way on from the call on screen: another kind joins an open call, else a fresh request. */
  function again(call: TableCall | null) {
    const open = call !== null && OPEN.includes(call.status)
    if (call !== null && !open) setMovedOn((now) => new Set([...now, call.id]))
    setPicking(open)
    setAsked(null)
    setKind(null)
    attempt.current = null
  }

  // What the sheet says, in this order: the guest's own request while it is on its way or did not
  // land (D72: their tap is answered, even over an open call), then the table's call as the host
  // has it, then a request the host took but has not listed yet.
  const inFlight = asked !== null && asked.phase !== 'sent' ? asked : null

  if (inFlight !== null) {
    if (inFlight.phase === 'sending') {
      return <StatePanel tone="wait" title={words.requesting} />
    }
    if (inFlight.phase === 'rejected') {
      const rejected = words.requestStates.rejected
      return (
        <StatePanel
          tone="bad"
          title={rejected.title}
          hint={
            inFlight.message === null ? (
              // The host's own message, else the code in the shell's words, else the panel's line.
              inFlight.code == null ? (
                rejected.hint
              ) : (
                refusalText(words, inFlight.code, { command: 'service.request' })
              )
            ) : (
              <Text value={inFlight.message} page={locale} />
            )
          }
        >
          <button
            type="button"
            className="ro-primary is-wide"
            data-design-part="button"
            onClick={() => again(null)}
          >
            <span>{words.newRequest}</span>
          </button>
        </StatePanel>
      )
    }
    // Lost (D120) and failed read differently: a lost request may be with the staff already, so it
    // never says it did not go through. Both offer the retry, which reuses the same action id.
    return (
      <StatePanel
        tone="bad"
        title={inFlight.phase === 'lost' ? words.callLost : words.requestFailed}
      >
        <button
          type="button"
          className="ro-primary is-wide"
          data-design-part="button"
          onClick={send}
        >
          <span>{words.retry}</span>
        </button>
        <button type="button" className="ro-ghost" onClick={() => again(null)}>
          {words.newRequest}
        </button>
      </StatePanel>
    )
  }

  if (current !== undefined && !picking) {
    const status = words.requestStates[current.status]
    // An open call takes another kind ("Something else"); a call that ended is followed by a new
    // one. With only `waiter` ticked there is nothing else to ask an open call for.
    const wayOn = !openNow || kinds.length > 1
    return (
      <StatePanel tone={TONES[current.status]} title={status.title} hint={status.hint}>
        <p className="ro-kind">{current.kinds.map((one) => words.kinds[one]).join(', ')}</p>
        {wayOn ? (
          <button
            type="button"
            className="ro-primary is-wide"
            data-design-part="button"
            data-call-more={openNow ? '' : undefined}
            onClick={() => again(current)}
          >
            <span>{words.newRequest}</span>
          </button>
        ) : null}
      </StatePanel>
    )
  }

  if (asked !== null) {
    const sentWords = words.requestStates.sent
    return <StatePanel tone="wait" title={sentWords.title} hint={sentWords.hint} />
  }

  if (single) {
    return (
      <div className="ro-sheet" data-design-part="call" data-call-single="">
        <button
          type="button"
          className="ro-primary is-wide"
          data-design-part="button"
          onClick={send}
        >
          <span>{words.callServer}</span>
        </button>
      </div>
    )
  }

  return (
    <div className="ro-sheet" data-design-part="call">
      <ChoiceGroup
        label={words.callPrompt}
        className="ro-choicegrid"
        part="call.kinds"
        value={chosen}
        onChoose={setKind}
        choices={kinds.map((option) => ({
          key: option,
          label: (
            <>
              {KIND_ICONS[option]()}
              <span>{words.kinds[option]}</span>
            </>
          ),
        }))}
      />
      <button
        type="button"
        className="ro-primary is-wide"
        data-design-part="button"
        disabled={!ready}
        onClick={send}
      >
        <span>{words.send}</span>
      </button>
    </div>
  )
}
