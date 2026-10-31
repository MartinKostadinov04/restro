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

/**
 * A frame must scroll itself and nothing around it: `focus()` and `scrollIntoView()` in an iframe
 * also scroll the page that holds the iframe, and a panel of tiles would jump about while its pictures
 * load. A tile's frame keeps `focus()` from scrolling at all (the sheet it opens focuses its close
 * button), and moves the sheet's own scroller by hand.
 */
export function holdScroll(frame: Window & typeof globalThis): void {
  const proto = frame.HTMLElement.prototype
  if ((proto.focus as { held?: true }).held === true) return
  const focus = proto.focus
  const held = function (this: HTMLElement, options?: FocusOptions) {
    return focus.call(this, { ...options, preventScroll: true })
  }
  ;(held as { held?: true }).held = true
  proto.focus = held
}

/** Scrolls the nearest scrolling box inside the sheet so that the part is in its middle. */
function scrollSheetTo(part: HTMLElement): void {
  for (
    let box = part.parentElement;
    box !== null && box !== document.body;
    box = box.parentElement
  ) {
    const overflowY = getComputedStyle(box).overflowY
    if (box.scrollHeight > box.clientHeight && (overflowY === 'auto' || overflowY === 'scroll')) {
      const inside = part.getBoundingClientRect().top - box.getBoundingClientRect().top
      box.scrollTop += inside - (box.clientHeight - part.clientHeight) / 2
      return
    }
  }
}

/**
 * Scrolls to the first part that exists: the page for a part of the menu, the sheet for one in a
 * sheet. True when one was found (or none was asked for).
 */
export function reveal(markers: readonly string[]): boolean {
  if (markers.length === 0) return true
  for (const marker of markers) {
    const part = document.querySelector<HTMLElement>(`[data-design-part="${marker}"]`)
    if (part === null) continue
    if (part.closest('[role="dialog"], dialog') !== null) {
      scrollSheetTo(part)
    } else {
      window.scrollTo({ top: Math.max(0, part.getBoundingClientRect().top + window.scrollY - 8) })
    }
    return true
  }
  return false
}

/** Presses the stage's controls one after the other, then scrolls. Returns what stops it. */
export function drive(stage: Stage, focus: readonly string[], onReached?: () => void): () => void {
  const way = WAYS[stage]
  const started = Date.now()
  let step = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const later = (run: () => void, ms: number) => {
    timer = setTimeout(run, ms)
  }
  const late = () => Date.now() - started > GIVE_UP_MS
  // The screen is up: scroll to the part once it is drawn (the renderer's code may still be on its
  // way), and once more a moment later, when fonts and photos have settled the page.
  const settle = () => {
    if (stopped) return
    if (reveal(focus) || late()) {
      later(() => {
        reveal(focus)
        onReached?.()
      }, 500)
      return
    }
    later(settle, STEP_MS)
  }
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
      later(settle, 250)
      return
    }
    if (late()) {
      settle()
      return
    }
    later(tick, STEP_MS)
  }
  tick()
  return () => {
    stopped = true
    if (timer !== undefined) clearTimeout(timer)
  }
}
