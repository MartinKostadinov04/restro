// Set-up for the web app's Vitest project (vitest.config.ts at the repo root). Tests that render
// components opt into jsdom with `// @vitest-environment jsdom`; everything here is a no-op in
// the Node environment.
import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// `next/font/google` works inside the Next.js compiler only: it reads each call's options at build
// time and swaps the call for the downloaded font's class names. Outside it (here) the real
// functions are placeholders that throw, so every module that reaches `src/fonts.ts` would fail to
// load. The stand-ins return what the compiler would (a class name per CSS variable) and keep
// their calls, which `src/fonts.test.ts` reads. One per family `src/fonts.ts` uses.
vi.mock('next/font/google', () => {
  const loader = () =>
    vi.fn((options: { variable?: string }) => ({
      className: `font-class${options.variable ?? ''}`,
      style: { fontFamily: 'font-family' },
      variable: `font-variable${options.variable ?? ''}`,
    }))
  return {
    Inter: loader(),
    Manrope: loader(),
    Montserrat: loader(),
    Playfair_Display: loader(),
    Lora: loader(),
    Unbounded: loader(),
  }
})

// `findBy…` and `waitFor` give up after 1 s by default; a full parallel run on this PC can take
// longer to render, so allow 5 s (a real failure still fails, only later).
configure({ asyncUtilTimeout: 5_000 })

afterEach(() => {
  // Testing Library only cleans up by itself when test globals are on; they are off here.
  cleanup()
})

if (typeof window !== 'undefined') {
  // jsdom has no matchMedia (the sidebar's useIsMobile and the editor sheet call it).
  if (!window.matchMedia) {
    window.matchMedia = (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList
  }
  // Radix UI measures and scrolls; jsdom does none of it.
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Element.prototype.scrollIntoView ??= () => undefined
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => undefined
  Element.prototype.releasePointerCapture ??= () => undefined
}
