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

/** A plus: adds a dish to the bag. */
export function PlusIcon() {
  return (
    <Svg round>
      <path d="M5 12h14M12 5v14" />
    </Svg>
  )
}

/** A raised hand: calls a waiter. */
export function HandIcon() {
  return (
    <Svg round>
      <path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2" />
      <path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2" />
      <path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </Svg>
  )
}

/** A bill with lines of text: the table bill. */
export function ReceiptIcon() {
  return (
    <Svg round>
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M14 8H8M16 12H8M13 16H8" />
    </Svg>
  )
}

/** A bank card: the card terminal, and the pay entry. */
export function CardIcon() {
  return (
    <Svg round>
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <path d="M2 10h20" />
    </Svg>
  )
}

/** Two drops: water. */
export function DropletsIcon() {
  return (
    <Svg round>
      <path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z" />
      <path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97" />
    </Svg>
  )
}

/** A fork and a knife: cutlery. */
export function UtensilsIcon() {
  return (
    <Svg round>
      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20" />
      <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
    </Svg>
  )
}

/** A service bell: calls a waiter. */
export function BellIcon() {
  return (
    <Svg round>
      <path d="M3 20a1 1 0 0 1-1-1v-1a1 1 0 0 1 1-1h18a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1Z" />
      <path d="M20 16a8 8 0 1 0-16 0M12 4v4M10 4h4" />
    </Svg>
  )
}

/** A speech bubble: something else. */
export function MessageIcon() {
  return (
    <Svg round>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
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
