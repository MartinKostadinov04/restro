// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import {
  isDark,
  isThemeChoice,
  parseThemeCookie,
  readThemeChoice,
  setThemeChoice,
  subscribeToTheme,
  THEME_COOKIE,
  THEME_INIT_SCRIPT,
} from './theme'

function runInitScript() {
  new Function(THEME_INIT_SCRIPT)()
}

function stubSystemScheme(dark: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: dark && query.includes('dark'),
      media: query,
    }) as MediaQueryList) as typeof window.matchMedia
}

describe('theme (light, dark, system)', () => {
  it('reads the stored choice from the cookie, system when absent or unknown', () => {
    expect(parseThemeCookie(`a=1; ${THEME_COOKIE}=dark; b=2`)).toBe('dark')
    expect(parseThemeCookie('a=1')).toBe('system')
    expect(parseThemeCookie(`${THEME_COOKIE}=purple`)).toBe('system')
    expect(isThemeChoice('light')).toBe(true)
    expect(isThemeChoice('purple')).toBe(false)
  })

  it('decides the dark class from the choice and the operating system', () => {
    expect(isDark('dark', false)).toBe(true)
    expect(isDark('light', true)).toBe(false)
    expect(isDark('system', true)).toBe(true)
    expect(isDark('system', false)).toBe(false)
  })

  it('wires dark mode for real: the inline script sets the class before paint', () => {
    const root = document.documentElement
    stubSystemScheme(true)
    // biome-ignore lint/suspicious/noDocumentCookie: the test sets the cookie the script reads
    document.cookie = `${THEME_COOKIE}=system; path=/`
    runInitScript()
    expect(root.classList.contains('dark')).toBe(true)

    // biome-ignore lint/suspicious/noDocumentCookie: the test sets the cookie the script reads
    document.cookie = `${THEME_COOKIE}=light; path=/`
    runInitScript()
    expect(root.classList.contains('dark')).toBe(false)

    stubSystemScheme(false)
    // biome-ignore lint/suspicious/noDocumentCookie: the test sets the cookie the script reads
    document.cookie = `${THEME_COOKIE}=dark; path=/`
    runInitScript()
    expect(root.classList.contains('dark')).toBe(true)
  })

  it('stores a new choice, applies it and tells subscribers', () => {
    stubSystemScheme(false)
    setThemeChoice('dark')
    expect(readThemeChoice()).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    setThemeChoice('light')
    expect(readThemeChoice()).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})

describe('theme robustness', () => {
  it('treats a malformed cookie escape as system instead of throwing', () => {
    expect(parseThemeCookie(`${THEME_COOKIE}=%`)).toBe('system')
    expect(parseThemeCookie(`a=1; ${THEME_COOKIE}=%E0%A4%A`)).toBe('system')
  })

  it('follows an operating-system scheme change while the choice is system', () => {
    let dark = false
    let onChange: (() => void) | undefined
    window.matchMedia = ((query: string) =>
      ({
        get matches() {
          return dark && query.includes('dark')
        },
        media: query,
        addEventListener: (_type: string, handler: () => void) => {
          onChange = handler
        },
        removeEventListener: () => {
          onChange = undefined
        },
      }) as unknown as MediaQueryList) as typeof window.matchMedia
    setThemeChoice('system')
    let notified = 0
    const unsubscribe = subscribeToTheme(() => {
      notified += 1
    })
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    dark = true
    onChange?.()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(notified).toBe(1)
    unsubscribe()
    expect(onChange).toBeUndefined()
  })
})
