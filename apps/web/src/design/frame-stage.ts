// How a frame of the Design page reaches a stage (D130, ticket 8): a tile of a screen's page shows that
// screen, so the frame presses the renderer's own controls, one after the other, as a person would,
// and scrolls to the part the option styles. The demo host behind the sheets is the preview's.
import type { Stage } from './advanced-model'

const slotOf = (name: string) => `[data-slot="${name}"]`

/**
 * The controls to press, in order, to reach a stage: each is pressed once it exists. A stage ends at
 * `until`, which is what shows when it is reached.
 */
export const WAYS: Readonly<
  Record<Stage, { readonly press: readonly string[]; readonly until: string | null }>
> = {
  menu: { press: [], until: null },
  order: { press: [slotOf('item.add')], until: slotOf('menu.bag') },
  bag: { press: [slotOf('item.add'), slotOf('menu.bag')], until: '[role="dialog"]' },
  bill: { press: [slotOf('menu.bill')], until: '[role="dialog"]' },
  call: { press: [slotOf('menu.call_waiter')], until: '[role="dialog"]' },
  pay: { press: [slotOf('menu.pay'), slotOf('pay.whole')], until: slotOf('pay.tip.row') },
  receipt: {
    press: [
      slotOf('menu.pay'),
      slotOf('pay.whole'),
      slotOf('pay.start'),
      `${slotOf('pay.form')} button`,
      slotOf('pay.confirmation.toggle'),
    ],
    until: slotOf('pay.confirmation'),
  },
  dish: { press: [slotOf('item.open')], until: '[role="dialog"]' },
}

/** How long the frame keeps looking for a control before it shows what it has. */
const GIVE_UP_MS = 20_000
const STEP_MS = 120

/** Scrolls to the first part that exists: the page for a part of the menu, the sheet for one in a sheet. */
export function reveal(markers: readonly string[]): void {
  for (const marker of markers) {
    const part = document.querySelector<HTMLElement>(`[data-design-part="${marker}"]`)
    if (part === null) continue
    if (part.closest('[role="dialog"], dialog') !== null) {
      part.scrollIntoView({ block: 'center' })
    } else {
      window.scrollTo({ top: Math.max(0, part.getBoundingClientRect().top + window.scrollY - 8) })
    }
    return
  }
}

/** Presses the stage's controls one after the other, then scrolls. Returns what stops it. */
export function drive(stage: Stage, focus: readonly string[], onReached?: () => void): () => void {
  const way = WAYS[stage]
  const started = Date.now()
  let step = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const tick = () => {
    if (stopped) return
    const press = way.press[step]
    if (press !== undefined) {
      const control = document.querySelector<HTMLElement>(press)
      if (control !== null) {
        control.click()
        step += 1
      }
    } else if (way.until === null || document.querySelector(way.until) !== null) {
      // The screen is up; a moment for its own entrance, then to the part.
      timer = setTimeout(() => {
        reveal(focus)
        onReached?.()
      }, 250)
      return
    }
    if (Date.now() - started > GIVE_UP_MS) {
      reveal(focus)
      onReached?.()
      return
    }
    timer = setTimeout(tick, STEP_MS)
  }
  tick()
  return () => {
    stopped = true
    if (timer !== undefined) clearTimeout(timer)
  }
}
