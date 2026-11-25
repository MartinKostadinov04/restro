// What the guest sees before there is a menu to draw: a loading skeleton and a friendly notice for
// an unknown or unpublished menu or a failed load. They are the page's own, not the renderer's.
//
// Where the venue's menu is already known (the renderer's code is still on its way, or failed to
// load) they take the venue's General look (D130): its colours for the screen the phone is on, its
// body font, its corners, the Buttons option and the text size and density. Where it is not (an
// unknown venue, a menu not published, a snapshot that did not load) nothing is known, and the
// stylesheet uses the browser's own colours, which follow a light or dark screen by themselves.

import type { DesignValues, ViewTheme } from '@restro/shell'
import type { CSSProperties } from 'react'

const NOTICE_CSS = `
.gp-root {
  /* The venue's look when the page has one (--gp-l-* for a light screen, --gp-d-* for a dark one),
     else the browser's colours. */
  --gp-bg: var(--gp-l-bg, Canvas);
  --gp-fg: var(--gp-l-fg, CanvasText);
  --gp-quiet: var(--gp-l-quiet, GrayText);
  --gp-button: var(--gp-l-button, Highlight);
  --gp-on-button: var(--gp-l-on-button, HighlightText);
  --gp-focus: var(--gp-l-focus, LinkText);
  --gp-radius: 8px;
  --gp-pill: 999px;
  --gp-type: 1;
  --gp-space: 1;
  color-scheme: light dark;
  min-height: 100dvh;
  background: var(--gp-bg);
  color: var(--gp-fg);
  font-family: var(--gp-font, system-ui, sans-serif);
  font-size: calc(16px * var(--gp-type));
  line-height: 1.45;
  -webkit-text-size-adjust: 100%;
}
.gp-root[data-scheme="light"] { color-scheme: light; }
.gp-root[data-scheme="dark"] { color-scheme: dark; }
.gp-root *, .gp-root *::before, .gp-root *::after { box-sizing: border-box; }
.gp-root :focus-visible { outline: 2px solid var(--gp-focus); outline-offset: 2px; }
.gp-root h1, .gp-root p { margin: 0; }
.gp-page { max-width: 40rem; margin: 0 auto; padding: 20px 16px 48px; }
.gp-skel { border-radius: var(--gp-radius); background: color-mix(in srgb, var(--gp-fg) 10%, transparent); }
.gp-notice { display: grid; place-content: center; justify-items: center; gap: calc(8px * var(--gp-space)); min-height: 100dvh; padding: 24px; text-align: center; }
.gp-notice h1 { font-size: calc(1.375rem * var(--gp-type)); font-weight: 600; }
.gp-notice p { color: var(--gp-quiet); }
.gp-button { min-height: 44px; padding: 0 20px; border: 0; border-radius: var(--gp-pill); background: var(--gp-button); color: var(--gp-on-button); font: inherit; font-weight: 600; cursor: pointer; }
@media (prefers-color-scheme: dark) {
  .gp-root:not([data-scheme="light"]) {
    --gp-bg: var(--gp-d-bg, Canvas);
    --gp-fg: var(--gp-d-fg, CanvasText);
    --gp-quiet: var(--gp-d-quiet, GrayText);
    --gp-button: var(--gp-d-button, Highlight);
    --gp-on-button: var(--gp-d-on-button, HighlightText);
    --gp-focus: var(--gp-d-focus, LinkText);
  }
}
.gp-root[data-scheme="dark"] {
  --gp-bg: var(--gp-d-bg, Canvas);
  --gp-fg: var(--gp-d-fg, CanvasText);
  --gp-quiet: var(--gp-d-quiet, GrayText);
  --gp-button: var(--gp-d-button, Highlight);
  --gp-on-button: var(--gp-d-on-button, HighlightText);
  --gp-focus: var(--gp-d-focus, LinkText);
}
@media (prefers-reduced-motion: no-preference) {
  .gp-skel { animation: gp-pulse 1.4s ease-in-out infinite; }
  @keyframes gp-pulse { 50% { opacity: 0.55; } }
}
`

/** The venue's General look as these two pages draw it: variables for the root, and the screen. */
export interface NoticeLook {
  readonly style: CSSProperties
  readonly scheme: 'auto' | 'light' | 'dark'
}

/** The pill of the renderer's buttons (`--rm-pill`) is the corner radius times this. */
const PILL = 1.6
/** The space General's density gives (the renderer's `--rm-space` over its comfortable step). */
const SPACE = { compact: 0.75, comfortable: 1, spacious: 1.25 } as const

/**
 * The look of the venue's menu for the notices: General's colours (both screens), body font, corners,
 * Buttons, text size and density. `fontStacks` maps a font to its self-hosted stack, as the renderer
 * has it; the rest of the design is the renderer's.
 */
export function noticeLook(
  theme: ViewTheme,
  design: DesignValues | undefined,
  fontStacks: Readonly<Record<string, string>> = {},
): NoticeLook {
  const general = design?.general
  const inkButtons = general?.buttons === 'ink'
  const colours = (prefix: 'l' | 'd', set: ViewTheme['colors']): Record<string, string> => ({
    [`--gp-${prefix}-bg`]: set.background,
    [`--gp-${prefix}-fg`]: set.text,
    [`--gp-${prefix}-quiet`]: set.muted,
    [`--gp-${prefix}-button`]: inkButtons ? set.text : set.accent,
    [`--gp-${prefix}-on-button`]: inkButtons ? set.background : set.onAccent,
    [`--gp-${prefix}-focus`]: set.accentText,
  })
  const space = SPACE[general?.density ?? 'comfortable']
  return {
    scheme: theme.scheme,
    style: {
      ...colours('l', theme.colors),
      ...colours('d', theme.colorsDark),
      '--gp-font': fontStacks[theme.font] ?? `"${theme.font}", system-ui, sans-serif`,
      '--gp-radius': `${theme.radius}px`,
      '--gp-pill': general?.corners === 'square' ? '0px' : `${Math.round(theme.radius * PILL)}px`,
      '--gp-type': general?.text_size === 'large' ? '1.125' : '1',
      '--gp-space': String(space),
    } as CSSProperties,
  }
}

function Styles() {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant stylesheet from this file, no user input
  return <style dangerouslySetInnerHTML={{ __html: NOTICE_CSS }} />
}

const block = (height: number, extra: CSSProperties = {}): CSSProperties => ({ height, ...extra })

/** A grey placeholder in the shape of the page: header, a jump bar and three cards. */
export function MenuSkeleton({
  label,
  lang,
  look,
}: {
  readonly label: string
  readonly lang: string
  readonly look?: NoticeLook
}) {
  return (
    <div
      className="gp-root"
      data-testid="menu-skeleton"
      data-scheme={look?.scheme}
      style={look?.style}
      lang={lang}
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      <Styles />
      <div className="gp-page" aria-hidden="true">
        <div className="gp-skel" style={block(32, { width: '55%', marginTop: 12 })} />
        <div className="gp-skel" style={block(16, { width: '80%', marginTop: 12 })} />
        <div className="gp-skel" style={block(44, { marginTop: 20, borderRadius: 999 })} />
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="gp-skel"
            style={block(index === 0 ? 220 : 120, { marginTop: 16 })}
          />
        ))}
      </div>
    </div>
  )
}

/** A short, kind message (unknown venue, not published yet, could not load) and an optional retry. */
export function MenuNotice({
  title,
  text,
  lang,
  actionLabel,
  onAction,
  look,
}: {
  readonly title: string
  readonly text: string
  readonly lang: string
  readonly actionLabel?: string
  readonly onAction?: () => void
  readonly look?: NoticeLook
}) {
  return (
    <div
      className="gp-root"
      data-testid="menu-notice"
      data-scheme={look?.scheme}
      style={look?.style}
      lang={lang}
    >
      <Styles />
      <div className="gp-notice">
        <h1>{title}</h1>
        <p>{text}</p>
        {actionLabel !== undefined && onAction !== undefined ? (
          <button type="button" className="gp-button" onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  )
}
