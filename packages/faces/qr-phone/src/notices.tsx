// What the guest sees before there is a menu to draw: a loading skeleton and a friendly notice for
// an unknown or unpublished menu or a failed load. No theme is known yet, so the stylesheet falls
// back to the browser's own colours, which follow a light or dark screen by themselves.

import type { CSSProperties } from 'react'

import { FACE_CSS } from './css'

function Styles() {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant stylesheet from css.ts, no user input
  return <style dangerouslySetInnerHTML={{ __html: FACE_CSS }} />
}

const block = (height: number, extra: CSSProperties = {}): CSSProperties => ({ height, ...extra })

/** A grey placeholder in the shape of the page: header, a jump bar and three cards. */
export function QrPhoneSkeleton({
  label,
  lang,
}: {
  readonly label: string
  readonly lang: string
}) {
  return (
    <div
      className="rq-root rq-neutral"
      data-face="qr-phone"
      data-testid="menu-skeleton"
      lang={lang}
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      <Styles />
      <div className="rq-page" aria-hidden="true">
        <div className="rq-skel" style={block(32, { width: '55%', marginTop: 12 })} />
        <div className="rq-skel" style={block(16, { width: '80%', marginTop: 12 })} />
        <div className="rq-skel" style={block(44, { marginTop: 20, borderRadius: 999 })} />
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="rq-skel"
            style={block(index === 0 ? 220 : 120, { marginTop: 16 })}
          />
        ))}
      </div>
    </div>
  )
}

/** A short, kind message (unknown venue, not published yet, could not load) and an optional retry. */
export function QrPhoneNotice({
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
    <div className="rq-root rq-neutral" data-face="qr-phone" data-testid="menu-notice" lang={lang}>
      <Styles />
      <div className="rq-notice">
        <h1>{title}</h1>
        <p>{text}</p>
        {actionLabel !== undefined && onAction !== undefined ? (
          <button type="button" className="rq-button" onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  )
}
