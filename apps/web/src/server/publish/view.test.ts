// How the tab reads the publish runs and words a percentage (brief S3-05). Pure.
import { describe, expect, it } from 'vitest'

import { percentOf, toPublishRunView } from './view'

const run = (overrides: Partial<Parameters<typeof toPublishRunView>[0]>) => ({
  id: 'jb_1',
  status: 'completed',
  counters: {},
  errorSummary: null,
  ...overrides,
})

describe('toPublishRunView', () => {
  it('a publish: the version it ended at', () => {
    expect(
      toPublishRunView(run({ counters: { snapshot_version: 3, published: 1, unchanged: 0 } })),
    ).toEqual({ id: 'jb_1', state: 'published', version: 3, refusal: null })
  })

  it('nothing new to publish: the version the menu already is', () => {
    expect(
      toPublishRunView(run({ counters: { snapshot_version: 2, published: 0, unchanged: 1 } })),
    ).toEqual({ id: 'jb_1', state: 'unchanged', version: 2, refusal: null })
  })

  it('a held automatic publish is not a published one', () => {
    expect(toPublishRunView(run({ counters: { snapshot_version: 4, held: 1 } }))).toMatchObject({
      state: 'held',
      version: 4,
    })
  })

  it('a run that has not finished is running, whatever it has counted so far', () => {
    for (const status of ['queued', 'running']) {
      expect(toPublishRunView(run({ status, counters: { published: 1 } }))).toEqual({
        id: 'jb_1',
        state: 'running',
        version: null,
        refusal: null,
      })
    }
  })

  it.each([
    ['publish refused: no_visible_items (V10)', 'no_visible_items'],
    ['publish refused: menu_blocked (missing_root)', 'menu_blocked'],
    ['publish refused: held_outdated', 'held_outdated'],
    ['publish refused: held_not_found', 'held_not_found'],
    ['publish refused: unsafe_snapshot', 'unsafe_snapshot'],
    ['publish refused: menu_not_found', 'other'],
  ])('reads a refusal from the run text: %s', (errorSummary, refusal) => {
    expect(toPublishRunView(run({ status: 'failed', errorSummary }))).toEqual({
      id: 'jb_1',
      state: 'refused',
      version: null,
      refusal,
    })
  })

  it('a failed run with any other text is a failure, not a refusal', () => {
    expect(toPublishRunView(run({ status: 'failed', errorSummary: 'connection reset' }))).toEqual({
      id: 'jb_1',
      state: 'failed',
      version: null,
      refusal: null,
    })
    expect(toPublishRunView(run({ status: 'failed' })).state).toBe('failed')
  })
})

describe('percentOf', () => {
  it('rounds to a whole percent, half up, and is 0 of nothing', () => {
    expect(percentOf(3, 5)).toBe(60)
    expect(percentOf(1, 3)).toBe(33)
    expect(percentOf(2, 3)).toBe(67)
    expect(percentOf(1, 8)).toBe(13)
    expect(percentOf(0, 0)).toBe(0)
    expect(percentOf(5, 0)).toBe(0)
  })
})
