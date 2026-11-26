// The spot picker of the booking page (#580; spec #322 story 5): the venue's floor plans drawn as
// staff see them, each spot a toggle the guest taps to pick it, free or taken for the night.
//
// What it draws comes from the published booking file (the plans) and the host's one narrow ask
// (free or taken per spot, story 32); nothing else. A spot's state is said in words and by shape,
// never by colour alone: a taken spot is hatched and cannot be pressed, a picked one is filled
// and ticked, and every toggle's name says its spot, its seats and its state.
//
// The plan keeps the drawing's proportions at any width. On a phone a plan of many small spots
// would shrink them below a finger, so the plan's box never draws its smallest spot narrower than
// a touch target: the plan scrolls sideways inside its own frame instead, and the page never does.

import type { BookingPlanView, BookingSpotState, BookingStrings } from '@restro/shell'
import type { CSSProperties } from 'react'

/** The narrowest a spot is drawn, in CSS pixels: the touch rule of the service screens. */
const SPOT_MIN_PX = 44

/** The widest a plan's box grows to keep its smallest spot touchable, in CSS pixels. */
const PLAN_MAX_PX = 1_200

/** The box width (px) at which the plan's narrowest spot is a touch target, or null for 100%. */
function planMinWidth(plan: BookingPlanView): number | null {
  const narrowest = Math.min(...plan.spots.map((spot) => spot.box.width))
  if (!Number.isFinite(narrowest) || narrowest <= 0) return null
  return Math.min(PLAN_MAX_PX, Math.ceil((SPOT_MIN_PX * 100) / narrowest))
}

export interface BookingPlanPickerProps {
  readonly id: string
  readonly plans: readonly BookingPlanView[]
  /** Free or taken per spot id; undefined while the night is being checked. */
  readonly states: Readonly<Record<string, BookingSpotState>> | undefined
  readonly picked: readonly string[]
  readonly onToggle: (spotId: string) => void
  readonly words: BookingStrings
  /** False in a preview without a host: drawn, and nothing can be pressed. */
  readonly enabled: boolean
}

/** The plans, the legend and what is picked. */
export function BookingPlanPicker(props: BookingPlanPickerProps) {
  const { id, plans, states, picked, onToggle, words, enabled } = props
  const names = plans
    .flatMap((plan) => plan.spots)
    .filter((spot) => picked.includes(spot.id))
    .map((spot) => spot.name)
  return (
    <fieldset className="bk-plans" aria-describedby={`${id}-hint`}>
      <legend className="bk-label">{words.spots}</legend>
      <p className="bk-hint" id={`${id}-hint`}>
        {states === undefined ? words.spotsChecking : words.spotsHint}
      </p>
      {plans.map((plan) => {
        const minWidth = planMinWidth(plan)
        return (
          <section className="bk-plan" key={plan.id} aria-label={plan.name}>
            {plans.length > 1 ? <h2 className="bk-plan-name">{plan.name}</h2> : null}
            <div className="bk-plan-frame">
              <div
                className="bk-plan-box"
                style={
                  {
                    aspectRatio: `1 / ${plan.aspect}`,
                    ...(minWidth === null ? {} : { minWidth: `${minWidth}px` }),
                  } as CSSProperties
                }
              >
                {plan.spots.map((spot) => {
                  const isPicked = picked.includes(spot.id)
                  const state = states?.[spot.id]
                  const shown = isPicked ? 'picked' : (state ?? 'checking')
                  const stateWord =
                    shown === 'picked'
                      ? words.spotPicked
                      : shown === 'taken'
                        ? words.spotTaken
                        : shown === 'free'
                          ? words.spotFree
                          : words.spotsChecking
                  const label = [
                    spot.name,
                    spot.area,
                    spot.seats === null ? null : words.spotSeats(spot.seats),
                    stateWord,
                  ]
                    .filter((part) => part !== null)
                    .join(', ')
                  return (
                    <button
                      key={spot.id}
                      type="button"
                      className="bk-spot"
                      data-shape={spot.shape}
                      data-state={shown}
                      aria-pressed={isPicked}
                      aria-label={label}
                      disabled={!enabled || (!isPicked && state !== 'free')}
                      onClick={() => onToggle(spot.id)}
                      style={
                        {
                          left: `${spot.box.left}%`,
                          top: `${spot.box.top}%`,
                          width: `${spot.box.width}%`,
                          height: `${spot.box.height}%`,
                          ...(spot.rotation === 0
                            ? {}
                            : { transform: `rotate(${spot.rotation}deg)` }),
                        } as CSSProperties
                      }
                    >
                      <span className="bk-spot-name" aria-hidden="true">
                        {isPicked ? `✓ ${spot.name}` : spot.name}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </section>
        )
      })}
      <ul className="bk-legend" aria-hidden="true">
        <li className="bk-key" data-state="free">
          {words.spotFree}
        </li>
        <li className="bk-key" data-state="taken">
          {words.spotTaken}
        </li>
        <li className="bk-key" data-state="picked">
          {words.spotPicked}
        </li>
      </ul>
      <p className="bk-picked" aria-live="polite">
        {names.length > 0 ? words.spotsPicked(names.join(', ')) : words.noSpotPicked}
      </p>
    </fieldset>
  )
}
