'use client'

// Tonight's one line about push on this device (RR-86, D120): its state, and one thing to do. On a
// person's own phone or browser, Turn on and Turn off are one tap each. A shared device has Turn on
// only: its account subscribes with no PIN, and ending it with no PIN and no name in the Log would
// let anyone at the bar silence the tablet's alerts (D122 §7). A browser that holds a subscription
// says it again when Tonight opens, so an endpoint that rotated doesn't silently stop.
import { BellIcon, BellOffIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { revokePushAction, subscribePushAction } from '@/server/tonight/actions'
import type { TonightResult } from '@/server/tonight/tables'

import {
  currentSubscription,
  deviceOf,
  type PushAvailability,
  pushAvailability,
  subscribeDevice,
} from './push-device'
import { useTonightRun } from './run'

type PushState = 'loading' | 'off' | 'on' | 'blocked' | Exclude<PushAvailability, 'ready'>

const ACCEPTED: TonightResult = { ok: true, details: {} }

export function PushControl({
  venueId,
  pushKey,
  sharedDevice,
}: {
  venueId: string
  pushKey: string
  sharedDevice: boolean
}) {
  const t = useTranslations('tonight')
  const { run, busy } = useTonightRun()
  const [state, setState] = useState<PushState>('loading')
  /** The endpoint the server last heard from this page, so a re-read doesn't say it again. */
  const told = useRef<string | null>(null)

  const read = useCallback(async () => {
    const availability = pushAvailability()
    if (availability !== 'ready') return setState(availability)
    if (Notification.permission === 'denied') return setState('blocked')
    let subscription: PushSubscription | null
    try {
      subscription = await currentSubscription(pushKey)
    } catch {
      return setState('off')
    }
    if (subscription === null) return setState('off')
    setState('on')
    const device = deviceOf(subscription)
    if (device === null || told.current === device.endpoint) return
    told.current = device.endpoint
    try {
      const said = await subscribePushAction({ venueId, ...device })
      // Refused, not merely unreached: this device can't ring, so it doesn't say it can.
      if (!said.ok && said.error !== 'failed') {
        await subscription.unsubscribe()
        setState('off')
      }
    } catch {
      // No connection: the next time Tonight opens says it again.
      told.current = null
    }
  }, [pushKey, venueId])

  useEffect(() => {
    void read()
    // Coming back from the browser's settings, or from adding Restro to the Home Screen.
    const again = () => {
      if (document.visibilityState === 'visible') void read()
    }
    document.addEventListener('visibilitychange', again)
    return () => document.removeEventListener('visibilitychange', again)
  }, [read])

  const turnOn = useCallback(async (): Promise<TonightResult> => {
    // First, in the tap itself: iOS asks only from a tap.
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      setState(permission === 'denied' ? 'blocked' : 'off')
      return { ok: false, error: 'push_not_allowed' }
    }
    let subscription: PushSubscription
    try {
      subscription = await subscribeDevice(pushKey)
    } catch {
      return { ok: false, error: 'push_no_service' }
    }
    const device = deviceOf(subscription)
    if (device === null) return { ok: false, error: 'push_no_service' }
    const said = await subscribePushAction({ venueId, ...device })
    if (!said.ok) {
      await subscription.unsubscribe().catch(() => false)
      setState('off')
      return said
    }
    told.current = device.endpoint
    setState('on')
    return said
  }, [pushKey, venueId])

  const turnOff = useCallback(async (): Promise<TonightResult> => {
    const subscription = await currentSubscription(pushKey)
    if (subscription === null) {
      setState('off')
      return ACCEPTED
    }
    const said = await revokePushAction({ venueId, endpoint: subscription.endpoint })
    if (!said.ok) return said
    told.current = null
    try {
      await subscription.unsubscribe()
    } catch {
      // The browser still holds it: read it again, which tells the server it is still on.
      await read()
      return { ok: false, error: 'failed' }
    }
    setState('off')
    return said
  }, [pushKey, read, venueId])

  function tapOn() {
    run({
      id: 'push',
      act: turnOn,
      done: t('push_on_toast'),
      ...(sharedDevice ? {} : { undo: turnOff }),
    })
  }
  function tapOff() {
    run({ id: 'push', act: turnOff, done: t('push_off_toast'), undo: turnOn })
  }

  const on = state === 'on'
  const words = {
    loading: '',
    off: sharedDevice ? t('push_off_shared') : t('push_off'),
    on: sharedDevice ? t('push_on_shared') : t('push_on'),
    blocked: t('push_blocked'),
    unsupported: t('push_unsupported'),
    install_first: t('push_install'),
  }[state]
  const Icon = on ? BellIcon : BellOffIcon

  return (
    <div
      className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground"
      data-testid="push-control"
      data-state={state}
    >
      {state === 'loading' ? null : (
        <p className="flex min-w-0 flex-1 basis-48 items-start gap-2">
          <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{words}</span>
        </p>
      )}
      {state === 'off' ? (
        <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={tapOn}>
          {t('push_turn_on')}
        </Button>
      ) : null}
      {on && !sharedDevice ? (
        <Button type="button" variant="ghost" className="h-11" disabled={busy} onClick={tapOff}>
          {t('push_turn_off')}
        </Button>
      ) : null}
    </div>
  )
}
