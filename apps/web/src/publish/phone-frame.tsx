'use client'

// A phone-shaped frame for the preview. The guest face is made for a whole page: it scrolls with
// the window, sticks its section bar to the top of the screen and opens its allergen sheet over the
// screen. Inside the frame those must mean the frame's screen, not the admin's window:
//
//   - the outer box clips and carries a transform, which makes it the containing block of the
//     face's `position: fixed` sheet, so the sheet covers the phone screen and nothing else;
//   - the inner box scrolls, so `position: sticky; top: 0` sticks to the top of the screen;
//   - the face's `min-height: 100dvh` (the browser window) becomes the screen's height.
//
// The rules below name the roots of the two faces the app has (`.rq-root`, `.rm`) and the Editorial
// Market's full-height dish page, whose height is the browser window's in the face's own style.
import type { ReactNode } from 'react'

const FRAME_CSS = `
.restro-phone .rq-root,
.restro-phone .rm { min-height: 100%; }
.restro-phone .rm-overlay-panel,
.restro-phone .rm-overlay-panel.is-detail { max-height: 100%; }
.restro-phone .rm-overlay-panel.is-detail { height: 100%; }
`

export function PhoneFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      className="restro-phone mx-auto w-full max-w-[22.5rem]"
      aria-label={label}
      data-testid="phone-frame"
    >
      <style>{FRAME_CSS}</style>
      <div className="overflow-hidden rounded-[2.25rem] border-[10px] border-neutral-800 bg-neutral-800 shadow-xl dark:border-neutral-600 dark:bg-neutral-600">
        <div
          className="relative overflow-hidden rounded-[1.5rem] bg-background"
          style={{ height: 'min(42rem, calc(100dvh - 15rem))', transform: 'translateZ(0)' }}
          data-testid="phone-screen"
        >
          <div
            className="h-full overflow-x-hidden overflow-y-auto overscroll-contain"
            data-testid="phone-scroll"
          >
            {children}
          </div>
        </div>
      </div>
    </section>
  )
}
