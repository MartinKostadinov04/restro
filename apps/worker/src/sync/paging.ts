// Reading a barsy list page by page, within barsy's 30-second limit per call (brief S2-03b).
//
// A page that times out, or that barsy ends at its own 30-second limit, is asked again with half
// the length, down to a floor (25 for articles); the smaller size is kept for the pages after it.
// Three failures at the floor mark that page failed and the read moves on to the next offset. A
// failed page is recorded as such (`pagesOk`): rule 6 lets a pull conclude nothing about absence
// unless every page succeeded.
//
// Three failed pages in a row end the read: the remainder cannot be told apart from "no more
// pages", and the read is incomplete either way.

import {
  BarsyAuthError,
  BarsyConfigError,
  BarsyHttpError,
  BarsyNetworkError,
  BarsyTimeoutError,
} from '@restro/barsy'

import type { Logger } from '../logger'
import { SyncError } from './errors'

/** Failures at the smallest page size before a page is given up. */
export const FAILURES_AT_FLOOR = 3

/** Pages that fail one after the other before the read stops. */
export const MAX_CONSECUTIVE_FAILED_PAGES = 3

/** Offsets beyond this are a runaway read, not a catalogue. */
const MAX_OFFSET = 200_000

export interface PagedRead<T> {
  readonly items: T[]
  /** One entry per page asked for: true when it was read. Never empty. */
  readonly pagesOk: boolean[]
  /** The page length the read ended with. */
  readonly finalLength: number
}

export interface PagingOptions<T> {
  readonly startLength: number
  readonly minLength: number
  /** Reads one page. Throws what the barsy client throws. */
  readonly fetchPage: (offset: number, length: number) => Promise<readonly T[]>
  readonly log: Logger
  readonly what: string
  readonly signal?: AbortSignal | undefined
}

/** Failures a smaller page may fix: a timeout, barsy's own 30 s error, a dropped connection. */
function isShrinkable(error: unknown): boolean {
  return (
    error instanceof BarsyTimeoutError ||
    error instanceof BarsyNetworkError ||
    (error instanceof BarsyHttpError && (error.status >= 500 || error.status === 408))
  )
}

export async function readPages<T>(options: PagingOptions<T>): Promise<PagedRead<T>> {
  const { startLength, minLength, fetchPage, log, what, signal } = options
  const items: T[] = []
  const pagesOk: boolean[] = []
  let offset = 0
  let length = startLength
  let consecutiveFailed = 0

  for (;;) {
    if (signal?.aborted) throw new SyncError('aborted', 'The worker is shutting down.')
    if (offset > MAX_OFFSET) {
      pagesOk.push(false)
      log.warn({ what }, 'paging stopped: the offset ran away')
      break
    }
    let rows: readonly T[] | null = null
    let failuresAtFloor = 0
    while (rows === null) {
      try {
        rows = await fetchPage(offset, length)
      } catch (error) {
        // Credentials and our own mistakes end the whole job; they are not a bad page.
        if (error instanceof BarsyAuthError || error instanceof BarsyConfigError) throw error
        if (!isShrinkable(error)) {
          log.warn({ what, offset, length, err: error }, 'a page could not be read')
          break
        }
        if (length > minLength) {
          const smaller = Math.max(minLength, Math.floor(length / 2))
          log.info({ what, offset, from: length, to: smaller }, 'page too slow: asking for fewer')
          length = smaller
          continue
        }
        failuresAtFloor += 1
        log.warn({ what, offset, length, failuresAtFloor, err: error }, 'a page failed')
        if (failuresAtFloor >= FAILURES_AT_FLOOR) break
      }
    }

    if (rows === null) {
      pagesOk.push(false)
      consecutiveFailed += 1
      if (consecutiveFailed >= MAX_CONSECUTIVE_FAILED_PAGES) {
        log.warn({ what, offset }, 'paging stopped after repeated failed pages')
        break
      }
      offset += length
      continue
    }
    consecutiveFailed = 0
    pagesOk.push(true)
    items.push(...rows)
    if (rows.length < length) break
    offset += length
  }
  return { items, pagesOk, finalLength: length }
}
