// The "call a waiter" sheet (`#call`). The guest picks one of the kinds the venue allows
// (`view.features.callWaiter.kinds`) and sends it; there is no note (#180). After that the
// sheet shows only what the host says: the request's own status from `state.requests`. A waiter is
// "on the way" only when a request of the host's says `on_the_way`; until the host's state has the
// request, the sheet says it was sent and is waiting. Cancelling sends `service.cancel`.

import type { RequestStatus, RequestView, ServiceKind, ViewText } from '@restro/shell'
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

/** The statuses in which a request can still be cancelled. */
const OPEN: readonly RequestStatus[] = ['sent', 'accepted', 'on_the_way']

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
  readonly phase: 'sending' | 'sent' | 'failed' | 'rejected'
  readonly message: ViewText | null
}

export function CallSheet() {
  const o = useServicesRequired()
  const { words, state, locale } = o
  const kinds = o.features.callWaiter?.kinds ?? []

  const [kind, setKind] = useState<ServiceKind | null>(null)
  const [asked, setAsked] = useState<Asked | null>(null)
  // Requests the guest has moved on from ("send another request"), by the host's id.
  const [movedOn, setMovedOn] = useState<ReadonlySet<string>>(new Set())
  const [cancelling, setCancelling] = useState(false)
  const [cancelFailed, setCancelFailed] = useState<ViewText | 'generic' | null>(null)
  const attempt = useRef<{ readonly key: string; readonly actionId: string } | null>(null)
  const cancelIds = useRef(new Map<string, string>())
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // The request this sheet is about: the one the guest just sent once the host lists it, else the
  // latest one still open (after a reload, or sent by another phone at the table).
  const sent =
    asked === null
      ? undefined
      : state.requests.find((request) => request.actionId === asked.actionId)
  const open = [...state.requests]
    .reverse()
    .find((request) => OPEN.includes(request.status) && !movedOn.has(request.id))
  const current = sent !== undefined && !movedOn.has(sent.id) ? sent : open

  const chosen = kind !== null && kinds.includes(kind) ? kind : null
  const ready = chosen !== null

  async function send() {
    if (chosen === null || !ready) return
    const key = chosen
    // The same request again (a retry) is the same action; a different one is new.
    const actionId = attempt.current?.key === key ? attempt.current.actionId : newActionId()
    attempt.current = { key, actionId }
    setAsked({ actionId, phase: 'sending', message: null })
    let outcome: Outcome = { ok: false }
    try {
      outcome = await o.run({ kind: 'service.request', actionId, request: chosen, note: '' })
    } catch {
      outcome = { ok: false }
    }
    if (!alive.current) return
    const settle = (phase: Asked['phase'], message: ViewText | null) =>
      setAsked((now) => (now?.actionId === actionId ? { actionId, phase, message } : now))
    if (!outcome.ok) {
      settle('failed', null) // the request may or may not have gone: a retry reuses the actionId
    } else if (outcome.result.status === 'rejected') {
      attempt.current = null
      settle('rejected', outcome.result.message)
    } else {
      attempt.current = null
      settle('sent', null)
    }
  }

  async function cancel(request: RequestView) {
    if (cancelling) return
    setCancelling(true)
    setCancelFailed(null)
    const actionId = cancelIds.current.get(request.id) ?? newActionId()
    cancelIds.current.set(request.id, actionId)
    let outcome: Outcome = { ok: false }
    try {
      outcome = await o.run({ kind: 'service.cancel', actionId, requestId: request.id })
    } catch {
      outcome = { ok: false }
    } finally {
      if (alive.current) setCancelling(false)
    }
    if (!alive.current) return
    if (!outcome.ok) {
      setCancelFailed('generic')
    } else if (outcome.result.status === 'rejected') {
      cancelIds.current.delete(request.id)
      setCancelFailed(outcome.result.message ?? 'generic')
    }
    // Accepted or pending: the request's status in the host's state shows what became of it.
  }

  function another(request: RequestView | null) {
    if (request !== null) setMovedOn((now) => new Set([...now, request.id]))
    setAsked(null)
    setKind(null)
    setCancelFailed(null)
    attempt.current = null
  }

  if (current !== undefined) {
    const status = words.requestStates[current.status]
    const cancellable = OPEN.includes(current.status)
    return (
      <StatePanel tone={TONES[current.status]} title={status.title} hint={status.hint}>
        <p className="ro-kind">{words.kinds[current.kind]}</p>
        {cancelFailed === null ? null : (
          <p className="ro-notice is-bad" role="alert">
            {cancelFailed === 'generic' ? (
              words.requestFailed
            ) : (
              <Text value={cancelFailed} page={locale} />
            )}
          </p>
        )}
        {cancellable ? (
          <button
            type="button"
            className="ro-ghost"
            disabled={cancelling}
            onClick={() => cancel(current)}
          >
            {words.cancelRequest}
          </button>
        ) : (
          <button type="button" className="ro-primary is-wide" onClick={() => another(current)}>
            <span>{words.newRequest}</span>
          </button>
        )}
      </StatePanel>
    )
  }

  if (asked !== null) {
    if (asked.phase === 'sending') {
      return <StatePanel tone="wait" title={words.requesting} />
    }
    if (asked.phase === 'sent') {
      const sentWords = words.requestStates.sent
      return <StatePanel tone="wait" title={sentWords.title} hint={sentWords.hint} />
    }
    if (asked.phase === 'rejected') {
      const rejected = words.requestStates.rejected
      return (
        <StatePanel
          tone="bad"
          title={rejected.title}
          hint={
            asked.message === null ? rejected.hint : <Text value={asked.message} page={locale} />
          }
        >
          <button type="button" className="ro-primary is-wide" onClick={() => another(null)}>
            <span>{words.newRequest}</span>
          </button>
        </StatePanel>
      )
    }
    return (
      <StatePanel tone="bad" title={words.requestFailed}>
        <button type="button" className="ro-primary is-wide" onClick={send}>
          <span>{words.retry}</span>
        </button>
        <button type="button" className="ro-ghost" onClick={() => another(null)}>
          {words.newRequest}
        </button>
      </StatePanel>
    )
  }

  return (
    <div className="ro-sheet">
      <ChoiceGroup
        label={words.callServer}
        className="ro-choicegrid"
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
      <button type="button" className="ro-primary is-wide" disabled={!ready} onClick={send}>
        <span>{words.send}</span>
      </button>
    </div>
  )
}
