// The layout switch: three icon-only buttons (list, one column, two columns) that decide how the
// items of the menu are laid out. A radio group in the ARIA sense: the chosen button is the one
// Tab stops on and the arrow keys move the choice.

import type { GuestStrings } from '@restro/shell'
import { type KeyboardEvent, type ReactNode, useRef } from 'react'

import { GridIcon, ListIcon, SquareIcon } from './icons'
import { LAYOUTS, type Layout } from './model'

const ICONS: Readonly<Record<Layout, ReactNode>> = {
  list: <ListIcon />,
  one: <SquareIcon />,
  two: <GridIcon />,
}

export function LayoutSwitch({
  layout,
  onChange,
  strings,
}: {
  readonly layout: Layout
  readonly onChange: (layout: Layout) => void
  readonly strings: GuestStrings
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const names: Readonly<Record<Layout, string>> = {
    list: strings.layoutList,
    one: strings.layoutOne,
    two: strings.layoutTwo,
  }

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = LAYOUTS.indexOf(layout)
    let next = current
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      next = (current + 1) % LAYOUTS.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      next = (current + LAYOUTS.length - 1) % LAYOUTS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = LAYOUTS.length - 1
    else return
    event.preventDefault()
    const target = LAYOUTS[next]
    if (target === undefined) return
    onChange(target)
    buttons.current[next]?.focus()
  }

  return (
    <div
      className="rm-layout"
      role="radiogroup"
      aria-label={strings.layout}
      onKeyDown={move}
      data-slot="menu.layout_switch"
      data-design-part="layout.switch"
    >
      {LAYOUTS.map((key, index) => (
        // biome-ignore lint/a11y/useSemanticElements: icon-only buttons styled as a segmented control; the group follows the ARIA radio pattern, arrow keys included
        <button
          key={key}
          ref={(element) => {
            buttons.current[index] = element
          }}
          type="button"
          role="radio"
          aria-checked={layout === key}
          aria-label={names[key]}
          title={names[key]}
          tabIndex={layout === key ? 0 : -1}
          onClick={() => onChange(key)}
        >
          {ICONS[key]}
        </button>
      ))}
    </div>
  )
}
