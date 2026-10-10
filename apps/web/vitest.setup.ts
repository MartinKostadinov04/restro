// Set-up for the web app's Vitest project (vitest.config.ts at the repo root). Tests that render
// components opt into jsdom with `// @vitest-environment jsdom`; everything here is a no-op in
// the Node environment.
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

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
