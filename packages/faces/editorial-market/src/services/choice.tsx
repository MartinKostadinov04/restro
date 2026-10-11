// A row of buttons of which one is on, in the ARIA radio-group pattern: the chosen button (or the
// first, while none is chosen) is the one Tab stops on, and the arrow keys, Home and End move the
// choice. The sheets use it for the kind of request, the share of the table and the tip. A tap on
// a button that is already on is passed on too, so a caller may let it switch off again.

import { type KeyboardEvent, type ReactNode, useRef } from 'react'

/** One button of the group. */
export interface Choice<T extends string> {
  readonly key: T
  readonly label: ReactNode
  /** What a screen reader says when the label is only a picture or an abbreviation. */
  readonly name?: string
  /** The language of the label when it is not the page's (a menu text in a fallback language). */
  readonly lang?: string | undefined
}

export function ChoiceGroup<T extends string>({
  label,
  className,
  choices,
  value,
  onChoose,
}: {
  /** The name of the group. */
  readonly label: string
  readonly className: string
  readonly choices: readonly Choice<T>[]
  /** The key that is on, or null. */
  readonly value: T | null
  readonly onChoose: (key: T) => void
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const chosen = choices.findIndex((choice) => choice.key === value)

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = chosen < 0 ? 0 : chosen
    let next = current
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      next = (current + 1) % choices.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      next = (current + choices.length - 1) % choices.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = choices.length - 1
    else return
    event.preventDefault()
    const target = choices[next]
    if (target === undefined) return
    onChoose(target.key)
    buttons.current[next]?.focus()
  }

  return (
    <div className={className} role="radiogroup" aria-label={label} onKeyDown={move}>
      {choices.map((choice, index) => (
        // biome-ignore lint/a11y/useSemanticElements: buttons styled as a segmented control; the group follows the ARIA radio pattern, arrow keys included
        <button
          key={choice.key}
          ref={(element) => {
            buttons.current[index] = element
          }}
          type="button"
          role="radio"
          aria-checked={choice.key === value}
          aria-label={choice.name}
          lang={choice.lang}
          tabIndex={index === (chosen < 0 ? 0 : chosen) ? 0 : -1}
          onClick={() => onChoose(choice.key)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  )
}
