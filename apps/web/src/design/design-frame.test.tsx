// @vitest-environment jsdom
// A frame's stage over time (S10): a frame with a stage holds `focus()` from scrolling and reaches
// it; once its stage is taken away (the live preview, the Dish page left) it lets go, closes the dish
// it opened and shows the menu. A frame that never had a stage closes nothing. The renderer's side
// of these steps is frame-stage.test.tsx's.
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Stage } from './advanced-model'
import { useStage } from './design-frame'

const stage = vi.hoisted(() => ({
  closeDish: vi.fn(),
  drive: vi.fn(),
  holdScroll: vi.fn(),
  release: vi.fn(),
  stop: vi.fn(),
}))
vi.mock('./frame-stage', () => ({
  closeDish: stage.closeDish,
  drive: stage.drive,
  holdScroll: stage.holdScroll,
}))

beforeEach(() => {
  for (const fn of Object.values(stage)) fn.mockReset()
  stage.drive.mockReturnValue(stage.stop)
  stage.holdScroll.mockReturnValue(stage.release)
})

describe('the stage of a frame', () => {
  it('goes back to the menu when its stage is taken away: lets go, closes the dish', () => {
    const { rerender } = renderHook(({ at }: { at: Stage | undefined }) => useStage(true, at, ''), {
      initialProps: { at: 'dish' as Stage | undefined },
    })
    expect(stage.holdScroll).toHaveBeenCalledTimes(1)
    expect(stage.drive).toHaveBeenLastCalledWith('dish', [])
    expect(stage.closeDish).not.toHaveBeenCalled()

    rerender({ at: undefined })
    expect(stage.stop).toHaveBeenCalledTimes(1)
    expect(stage.release).toHaveBeenCalledTimes(1)
    expect(stage.closeDish).toHaveBeenCalledTimes(1)
    expect(stage.drive).toHaveBeenLastCalledWith('menu', [])
    expect(stage.holdScroll).toHaveBeenCalledTimes(1)
  })

  it('a frame that never had a stage closes nothing and holds nothing', () => {
    const { rerender } = renderHook(
      ({ focus }: { focus: string }) => useStage(true, undefined, focus),
      {
        initialProps: { focus: '' },
      },
    )
    rerender({ focus: 'item' })
    expect(stage.closeDish).not.toHaveBeenCalled()
    expect(stage.holdScroll).not.toHaveBeenCalled()
    expect(stage.drive).toHaveBeenLastCalledWith('menu', ['item'])
  })
})
