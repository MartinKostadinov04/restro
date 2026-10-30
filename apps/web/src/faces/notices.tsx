// What the guest sees before there is a menu to draw: a loading skeleton and a friendly notice for
// an unknown or unpublished menu or a failed load. They are the page's own, not the renderer's: no
// theme or design is known yet, so the stylesheet uses the browser's own colours, which follow a
// light or dark screen by themselves.

import type { CSSProperties } from 'react'

const NOTICE_CSS = `
.gp-root {
  color-scheme: light dark;
  min-height: 100dvh;
  background: Canvas;
  color: CanvasText;
  font-family: system-ui, sans-serif;
  font-size: 16px;
  line-height: 1.45;
  -webkit-text-size-adjust: 100%;
}
.gp-root *, .gp-root *::before, .gp-root *::after { box-sizing: border-box; }
.gp-root :focus-visible { outline: 2px solid LinkText; outline-offset: 2px; }
.gp-root h1, .gp-root p { margin: 0; }
.gp-page { max-width: 40rem; margin: 0 auto; padding: 20px 16px 48px; }
.gp-skel { border-radius: 8px; background: color-mix(in srgb, CanvasText 10%, transparent); }
.gp-notice { display: grid; place-content: center; justify-items: center; gap: 8px; min-height: 100dvh; padding: 24px; text-align: center; }
.gp-notice h1 { font-size: 1.375rem; font-weight: 600; }
.gp-notice p { color: GrayText; }
.gp-button { min-height: 44px; padding: 0 20px; border: 0; border-radius: 999px; background: Highlight; color: HighlightText; font: inherit; font-weight: 600; cursor: pointer; }
@media (prefers-reduced-motion: no-preference) {
  .gp-skel { animation: gp-pulse 1.4s ease-in-out infinite; }
  @keyframes gp-pulse { 50% { opacity: 0.55; } }
}
`

function Styles() {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant stylesheet from this file, no user input
  return <style dangerouslySetInnerHTML={{ __html: NOTICE_CSS }} />
}

const block = (height: number, extra: CSSProperties = {}): CSSProperties => ({ height, ...extra })

/** A grey placeholder in the shape of the page: header, a jump bar and three cards. */
export function MenuSkeleton({ label, lang }: { readonly label: string; readonly lang: string }) {
  return (
    <div
      className="gp-root"
      data-testid="menu-skeleton"
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
}: {
  readonly title: string
  readonly text: string
  readonly lang: string
  readonly actionLabel?: string
  readonly onAction?: () => void
}) {
  return (
    <div className="gp-root" data-testid="menu-notice" lang={lang}>
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
