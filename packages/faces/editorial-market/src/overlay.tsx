// The dialog every sheet and the dish page are built on: a modal panel over a veil, named by its
// title, with the focus moved onto its close button, the Tab key kept inside it, the page behind
// it kept from scrolling and a tap on the veil closing it. Escape is handled by the face (it knows
// which of several stacked dialogs is the top one); the face also hands the focus back on close.

import { type ReactNode, useEffect, useId, useRef } from 'react'

import { BackIcon, CloseIcon } from './icons'

const FOCUSABLE =
  'button:not([disabled]):not([tabindex="-1"]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'

/** How many dialogs hold the page still: stacked dialogs close in any order, the last one frees it. */
let scrollLocks = 0

export function Overlay({
  title,
  titleLang,
  closeLabel,
  onClose,
  children,
  detail = false,
  leaving = false,
  extra = null,
}: {
  /** The name of the dialog. */
  readonly title: string
  /** The title's language when it is not the page's (the name of a dish can be a fallback text). */
  readonly titleLang?: string | undefined
  /** The name of the close control, a word from the shell's strings. */
  readonly closeLabel: string
  readonly onClose: () => void
  readonly children: ReactNode
  /** The dish page: full screen, a round back button over the photo. */
  readonly detail?: boolean
  /** The dialog is on its way out (the exit animation is playing). */
  readonly leaving?: boolean
  /** One more control beside the close button. */
  readonly extra?: ReactNode
}) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    close.current?.focus({ preventScroll: true })
    scrollLocks += 1
    document.body.style.overflow = 'hidden'
    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const nodes = panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
      const first = nodes?.[0]
      const last = nodes?.[nodes.length - 1]
      if (first === undefined || last === undefined) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', keepFocusInside)
    return () => {
      scrollLocks -= 1
      if (scrollLocks === 0) document.body.style.overflow = ''
      document.removeEventListener('keydown', keepFocusInside)
    }
  }, [])

  return (
    <div
      className={leaving ? 'rm-overlay is-leaving' : 'rm-overlay'}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        className={detail ? 'rm-overlay-panel is-detail' : 'rm-overlay-panel'}
        data-design-part={detail ? undefined : 'sheet'}
      >
        <div className="rm-overlay-head">
          <span id={titleId} lang={titleLang}>
            {title}
          </span>
          <button ref={close} type="button" onClick={onClose} aria-label={closeLabel}>
            {detail ? <BackIcon /> : <CloseIcon />}
          </button>
          {extra}
        </div>
        {children}
      </div>
    </div>
  )
}
