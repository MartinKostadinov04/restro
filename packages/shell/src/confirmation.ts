// The Payment confirmation (#197, D127 1.4, the guide's "Guest words: the bill and paying"): Restro's
// own page on the Paid screen, for the phone that paid. Pure functions so both faces draw the same
// facts and the same words, and one Save.
//
// - `confirmationOf` turns the captured payment, the venue's name and the words into the page's
//   facts: the venue, the date and time in the venue's time zone, the lines, the tip, the total in
//   EUR, "Paid by card", the payment number and the line "This is not your receipt…".
// - `drawConfirmation` and `saveConfirmation` make an image of it and keep it on the phone: the
//   share sheet where the phone has one, else a download of a `blob:` file whose link is dropped soon.
//   Nothing is sent anywhere and no link to it lasts (D127 1.4).
//
// It must not look like a receipt: a plain card in the page's own sans-serif, with no VAT, no
// receipt number, no QR code and no tax-office header. Stripe's receipt link is not used.

import { type Locale, localeToBcp47 } from '@restro/core'

import { lineNameText, payMoney } from './paying'
import type { PaymentView } from './services'
import type { PayingStrings } from './strings'

/** One line of the confirmation: what was paid for and its amount, both as text. */
export interface ConfirmationLine {
  readonly text: string
  readonly amount: string
}

/** What the Payment confirmation shows. */
export interface ConfirmationView {
  readonly title: string
  /** The venue's name, or null where the host did not send it. */
  readonly venue: string | null
  /** The date and time in the venue's time zone, or null where the payment has no time. */
  readonly when: string | null
  readonly lines: readonly ConfirmationLine[]
  /** The tip, null when there was none. */
  readonly tip: { readonly label: string; readonly amount: string } | null
  readonly total: { readonly label: string; readonly amount: string }
  /** "Paid by card". */
  readonly paidBy: string
  readonly number: { readonly label: string; readonly value: string }
  /** "This is not your receipt. …": the waiter's line, or the emailed one (#186). */
  readonly note: string
  readonly saveLabel: string
}

/** What the confirmation is made from. */
export interface ConfirmationInput {
  readonly payment: PaymentView
  /** The venue's name (`paying.venueName`). */
  readonly venueName: string | null
  readonly locale: Locale
  readonly words: PayingStrings
  /** "Other item" (`strings.services.otherItem`): the name of a line that has none. */
  readonly otherItem: string
  /**
   * The address the venue's electronic receipt went to, where there is one (#186): the note then
   * says the receipt was sent there. Nothing sets it before a connector declares the receipt.
   */
  readonly receiptEmail?: string | null
}

/** "×2" after a name for a line of more than one. */
function mark(quantity: string): string {
  return quantity === '1' ? '' : ` ×${quantity}`
}

/**
 * The instant as the venue's clock shows it, in the guest's language ("29 Oct 2026, 21:42"), or
 * null when the instant or the zone is not one.
 */
export function formatPaidAt(iso: string | null, timeZone: string, locale: Locale): string | null {
  if (iso === null) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  try {
    return new Intl.DateTimeFormat(localeToBcp47(locale), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(at)
  } catch {
    return null
  }
}

/** The confirmation of a captured payment. A payment that is not captured has none (D72). */
export function confirmationOf(input: ConfirmationInput): ConfirmationView | null {
  const { payment, words, locale } = input
  if (payment.state !== 'captured' || payment.amountMinor === null) return null
  const money = (minor: number) => payMoney(minor, payment.currency, locale)
  const venue = input.venueName?.trim() ?? ''
  return {
    title: words.confirmTitle,
    venue: venue === '' ? null : venue,
    when: formatPaidAt(payment.paidAt, payment.timeZone, locale),
    lines: payment.lines.map((line) => ({
      text: `${lineNameText(line.name, locale, input.otherItem)}${mark(line.quantity)}`,
      amount: money(line.amountMinor),
    })),
    tip: payment.tipMinor > 0 ? { label: words.tip, amount: money(payment.tipMinor) } : null,
    total: { label: words.total, amount: money(payment.amountMinor) },
    paidBy: words.paidByCard,
    number: { label: words.paidNumber, value: payment.number },
    note:
      input.receiptEmail == null
        ? words.confirmNotReceipt
        : words.confirmReceiptEmailed(input.receiptEmail),
    saveLabel: words.confirmSave,
  }
}

/** Every word the confirmation shows, for a test that looks for words it must never have. */
export function confirmationWords(view: ConfirmationView): readonly string[] {
  return [
    view.title,
    view.venue ?? '',
    view.when ?? '',
    ...view.lines.flatMap((line) => [line.text, line.amount]),
    view.tip?.label ?? '',
    view.tip?.amount ?? '',
    view.total.label,
    view.total.amount,
    view.paidBy,
    view.number.label,
    view.number.value,
    view.note,
    view.saveLabel,
  ].filter((word) => word !== '')
}

/* ---------------------------------------------------------------------------------------------
 * The image
 * ------------------------------------------------------------------------------------------- */

/** The part of a canvas 2D context the drawing uses, so a test can pass a recording one. */
export interface ConfirmationCanvas {
  fillStyle: string
  font: string
  textAlign: 'left' | 'right' | 'center'
  textBaseline: 'alphabetic' | 'top'
  fillRect(x: number, y: number, width: number, height: number): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): { readonly width: number }
}

/** The image's width in CSS pixels; its height follows the lines. */
export const CONFIRMATION_WIDTH = 480

const PAD = 32
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

/** Breaks `text` into rows no wider than `width` at the context's font (words, then letters). */
function wrap(ctx: ConfirmationCanvas, text: string, width: number): string[] {
  const rows: string[] = []
  let row = ''
  for (const word of text.split(/\s+/).filter((part) => part !== '')) {
    const next = row === '' ? word : `${row} ${word}`
    if (ctx.measureText(next).width <= width) {
      row = next
      continue
    }
    if (row !== '') rows.push(row)
    row = word
    while (ctx.measureText(row).width > width && row.length > 1) {
      let cut = row.length - 1
      while (cut > 1 && ctx.measureText(row.slice(0, cut)).width > width) cut -= 1
      rows.push(row.slice(0, cut))
      row = row.slice(cut)
    }
  }
  if (row !== '') rows.push(row)
  return rows
}

/**
 * Draws the confirmation on `ctx` and returns the height it needs. Called once with a context to
 * measure (nothing visible) and again on the sized canvas.
 */
export function drawConfirmation(
  ctx: ConfirmationCanvas,
  view: ConfirmationView,
  width: number = CONFIRMATION_WIDTH,
  paint: boolean = true,
): number {
  const inner = width - PAD * 2
  let y = PAD
  const ink = '#1b1b1f'
  const quiet = '#5d5d66'
  const text = (value: string, x: number, align: 'left' | 'right', color: string) => {
    if (!paint) return
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.fillText(value, x, y)
  }
  /** A paragraph of wrapped rows; returns nothing, advances `y`. */
  const paragraph = (value: string, size: number, weight: string, color: string) => {
    ctx.font = `${weight} ${size}px ${SANS}`
    for (const row of wrap(ctx, value, inner)) {
      text(row, PAD, 'left', color)
      y += Math.round(size * 1.4)
    }
  }
  /** A label on the left and an amount on the right. */
  const pair = (left: string, right: string, size: number, weight: string, color: string) => {
    ctx.font = `${weight} ${size}px ${SANS}`
    const amountWidth = ctx.measureText(right).width
    const rows = wrap(ctx, left, inner - amountWidth - 16)
    for (const [index, row] of rows.entries()) {
      text(row, PAD, 'left', color)
      if (index === 0) text(right, width - PAD, 'right', color)
      y += Math.round(size * 1.5)
    }
  }
  const rule = () => {
    y += 6
    if (paint) {
      ctx.fillStyle = '#e3e3e8'
      ctx.fillRect(PAD, y, inner, 1)
    }
    y += 16
  }

  if (paint) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, 100_000)
  }
  ctx.textBaseline = 'alphabetic'
  y += 22
  paragraph(view.title, 22, '700', ink)
  if (view.venue !== null) paragraph(view.venue, 16, '600', ink)
  if (view.when !== null) paragraph(view.when, 14, '400', quiet)
  rule()
  y += 4
  for (const line of view.lines) pair(line.text, line.amount, 15, '400', ink)
  rule()
  if (view.tip !== null) pair(view.tip.label, view.tip.amount, 15, '400', ink)
  pair(view.total.label, view.total.amount, 18, '700', ink)
  y += 6
  paragraph(view.paidBy, 14, '400', quiet)
  pair(view.number.label, view.number.value, 15, '600', ink)
  rule()
  paragraph(view.note, 13, '400', quiet)
  return y + PAD - 8
}

/** The canvas the image is drawn on; the browser's `HTMLCanvasElement` is one. */
export interface SaveCanvas {
  getContext(kind: '2d'): (ConfirmationCanvas & { scale(x: number, y: number): void }) | null
  toBlob(done: (blob: Blob | null) => void, type?: string): void
}

/** What the share sheet is handed: the image as a file. */
export interface SaveShare {
  readonly files: File[]
}

/** What saving needs of the phone; the browser's own by default, a test passes its own. */
export interface SaveEnv {
  readonly createCanvas: (width: number, height: number) => SaveCanvas
  readonly share?: (data: SaveShare) => Promise<void>
  readonly canShare?: (data: SaveShare) => boolean
  readonly createObjectURL: (blob: Blob) => string
  readonly revokeObjectURL: (url: string) => void
  readonly download: (url: string, name: string) => void
  readonly pixelRatio: number
}

/** The few browser objects Save uses, typed here because the shell compiles without the DOM. */
interface Anchor {
  href: string
  download: string
  rel: string
  click(): void
  remove(): void
}
interface BrowserGlobals {
  document?: {
    createElement(tag: 'canvas'): SaveCanvas & { width: number; height: number }
    createElement(tag: 'a'): Anchor
    body: { append(node: Anchor): void }
  }
  navigator?: {
    share?(data: SaveShare): Promise<void>
    canShare?(data: SaveShare): boolean
  }
  devicePixelRatio?: number
}

/** The phone's own environment. */
export function browserSaveEnv(): SaveEnv {
  const browser = globalThis as unknown as BrowserGlobals
  const nav = browser.navigator
  const doc = browser.document
  if (doc === undefined) throw new Error('no document')
  return {
    createCanvas: (width, height) => {
      const canvas = doc.createElement('canvas')
      canvas.width = width
      canvas.height = height
      return canvas
    },
    ...(nav?.share === undefined
      ? {}
      : { share: (data: SaveShare) => nav.share?.(data) ?? Promise.resolve() }),
    ...(nav?.canShare === undefined
      ? {}
      : { canShare: (data: SaveShare) => nav.canShare?.(data) ?? false }),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    download: (url, name) => {
      const link = doc.createElement('a')
      link.href = url
      link.download = name
      link.rel = 'noopener'
      doc.body.append(link)
      link.click()
      link.remove()
    },
    pixelRatio: Math.min(browser.devicePixelRatio || 1, 3),
  }
}

/** The confirmation as a PNG, drawn on a canvas at the phone's pixel ratio. */
export function confirmationImage(view: ConfirmationView, env: SaveEnv): Promise<Blob> {
  const measure = env.createCanvas(CONFIRMATION_WIDTH, 10).getContext('2d')
  if (measure === null) return Promise.reject(new Error('no canvas'))
  const height = drawConfirmation(measure, view, CONFIRMATION_WIDTH, false)
  const ratio = env.pixelRatio
  const canvas = env.createCanvas(
    Math.round(CONFIRMATION_WIDTH * ratio),
    Math.round(height * ratio),
  )
  const ctx = canvas.getContext('2d')
  if (ctx === null) return Promise.reject(new Error('no canvas'))
  ctx.scale(ratio, ratio)
  drawConfirmation(ctx, view, CONFIRMATION_WIDTH, true)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob === null ? reject(new Error('no image')) : resolve(blob)),
      'image/png',
    )
  })
}

/** How a Save ended: kept on the phone, or the guest closed the share sheet. */
export type SaveOutcome = 'saved' | 'dismissed'

/** How long a download link lives before it is revoked: long enough for a slow phone to start it. */
export const DOWNLOAD_LINK_MS = 40_000

/** The confirmation's image, drawn ahead of the tap. */
export interface PreparedConfirmation {
  /** The PNG; rejects where the phone could not draw it. */
  readonly image: Promise<Blob>
  readonly name: string
  readonly env: () => SaveEnv
}

/**
 * Draws the image as the confirmation opens, so the Save tap has it ready: a share sheet needs
 * the tap's activation, and drawing after the tap could outlast it. A failure waits for Save,
 * which then rejects.
 */
export function prepareConfirmation(
  view: ConfirmationView,
  env: () => SaveEnv = browserSaveEnv,
): PreparedConfirmation {
  let image: Promise<Blob>
  try {
    image = confirmationImage(view, env())
  } catch (error) {
    image = Promise.reject(error)
  }
  // Handled here so an unused image is no unhandled rejection; Save awaits it and sees the error.
  image.catch(() => undefined)
  return { image, name: `payment-${view.number.value}.png`, env }
}

/**
 * Keeps the confirmation on the phone as an image: the share sheet (where "Save Image" lives) when
 * the phone can share a file, else a download of a `blob:` file whose link is revoked soon after.
 * It sends nothing anywhere and leaves no lasting link (D127 1.4). A failure rejects: the face
 * shows its failure line, never a success.
 */
export async function saveConfirmation(prepared: PreparedConfirmation): Promise<SaveOutcome> {
  const blob = await prepared.image
  const env = prepared.env()
  const file = new File([blob], prepared.name, { type: 'image/png' })
  const data: SaveShare = { files: [file] }
  if (env.share !== undefined && env.canShare?.(data) === true) {
    try {
      await env.share(data)
      return 'saved'
    } catch (error) {
      // The guest closing the sheet is not a failure; anything else falls back to a download.
      if (error instanceof DOMException && error.name === 'AbortError') return 'dismissed'
    }
  }
  const url = env.createObjectURL(blob)
  try {
    env.download(url, prepared.name)
  } finally {
    // The click has started the download; the file is the phone's now and the link goes.
    setTimeout(() => env.revokeObjectURL(url), DOWNLOAD_LINK_MS)
  }
  return 'saved'
}
