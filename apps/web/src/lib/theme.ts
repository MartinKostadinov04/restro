// Light / dark / system, kept in a cookie (no localStorage, so the server could read it too).
// The root layout's inline script (components/theme-script.tsx) applies the stored choice to
// <html> before the first paint; the functions here change it afterwards.

/** What the person picked. `system` follows the operating system's colour scheme. */
export type ThemeChoice = 'system' | 'light' | 'dark'

export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark']

/** Name of the cookie that holds the choice. */
export const THEME_COOKIE = 'restro_theme'

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (THEME_CHOICES as readonly string[]).includes(value)
}

/** The stored choice from a `document.cookie` string; `system` when absent or unknown. */
export function parseThemeCookie(cookie: string): ThemeChoice {
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === THEME_COOKIE) {
      const value = decodeURIComponent(rest.join('='))
      return isThemeChoice(value) ? value : 'system'
    }
  }
  return 'system'
}

/** Whether `.dark` belongs on <html> for this choice and operating-system preference. */
export function isDark(choice: ThemeChoice, systemPrefersDark: boolean): boolean {
  return choice === 'dark' || (choice === 'system' && systemPrefersDark)
}

/**
 * The script the root layout inlines in <head>. It runs before the first paint, reads the
 * cookie and sets `.dark` on <html>. Kept as a string here so a test can run it.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]*)/);var c=m?decodeURIComponent(m[1]):"system";var d=c==="dark"||(c!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`

const listeners = new Set<() => void>()

/** For `useSyncExternalStore`. */
export function subscribeToTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The stored choice in the browser (`system` outside it). For `useSyncExternalStore`. */
export function readThemeChoice(): ThemeChoice {
  if (typeof document === 'undefined') return 'system'
  return parseThemeCookie(document.cookie)
}

/** Puts `.dark` on <html> (or takes it off) for `choice` now. */
export function applyThemeChoice(choice: ThemeChoice): void {
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle('dark', isDark(choice, systemPrefersDark))
}

/** Stores the choice, applies it and tells every `useSyncExternalStore` subscriber. */
export function setThemeChoice(choice: ThemeChoice): void {
  // biome-ignore lint/suspicious/noDocumentCookie: a plain cookie is the storage on purpose
  document.cookie = `${THEME_COOKIE}=${choice}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
  applyThemeChoice(choice)
  for (const listener of listeners) listener()
}
