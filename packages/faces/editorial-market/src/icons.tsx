// The face's icons, drawn inline: faces depend on React only, so no icon pack. Every icon is a
// 24 by 24 outline drawn with `currentColor`; the stylesheet sets the size and the stroke width.

import type { ReactNode } from 'react'

function Svg({
  children,
  round = false,
}: {
  readonly children: ReactNode
  readonly round?: boolean
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeLinecap={round ? 'round' : undefined}
      strokeLinejoin={round ? 'round' : undefined}
    >
      {children}
    </svg>
  )
}

/** Sliders: opens the filter sheet. */
export function FilterIcon() {
  return (
    <Svg>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M7 14v6" />
    </Svg>
  )
}

/** A cross: closes a sheet. */
export function CloseIcon() {
  return (
    <Svg>
      <path d="m5 5 14 14M19 5 5 19" />
    </Svg>
  )
}

/** A left chevron: closes the dish page and goes back to the menu. */
export function BackIcon() {
  return (
    <Svg>
      <path d="m15 5-7 7 7 7" />
    </Svg>
  )
}

/** A circled "i": opens the allergen sheet from the dish page. */
export function InfoIcon() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </Svg>
  )
}

/** Three rows with bullets: the list layout. */
export function ListIcon() {
  return (
    <Svg round>
      <path d="M3 12h.01M3 18h.01M3 6h.01M8 12h13M8 18h13M8 6h13" />
    </Svg>
  )
}

/** One square: the one-column layout. */
export function SquareIcon() {
  return (
    <Svg round>
      <rect width="18" height="18" x="3" y="3" rx="2" />
    </Svg>
  )
}

/** Four squares: the two-column layout. */
export function GridIcon() {
  return (
    <Svg round>
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </Svg>
  )
}
