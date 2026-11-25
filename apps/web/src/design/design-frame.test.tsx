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
  closeStage: vi.fn(),
  drive: vi.fn(),
  holdScroll: vi.fn(),
  release: vi.fn(),
  stop: vi.fn(),
}))
vi.mock('./frame-stage', () => ({
  closeStage: stage.closeStage,
  drive: stage.drive,
  holdScroll: stage.holdScroll,
}))

beforeEach(() => {
  for (const fn of Object.values(stage)) fn.mockReset()
  stage.drive.mockReturnValue(stage.stop)
  stage.holdScroll.mockReturnValue(stage.release)
})

describe('the stage of a frame', () => {
  it('goes back to the menu when its stage is taken away: lets go, closes the dish or sheet', () => {
    const { rerender } = renderHook(({ at }: { at: Stage | undefined }) => useStage(true, at, ''), {
      initialProps: { at: 'dish' as Stage | undefined },
    })
    expect(stage.holdScroll).toHaveBeenCalledTimes(1)
    expect(stage.drive).toHaveBeenLastCalledWith('dish', [])
    expect(stage.closeStage).not.toHaveBeenCalled()

    rerender({ at: undefined })
    expect(stage.stop).toHaveBeenCalledTimes(1)
    expect(stage.release).toHaveBeenCalledTimes(1)
    expect(stage.closeStage).toHaveBeenCalledTimes(1)
    expect(stage.drive).toHaveBeenLastCalledWith('menu', [])
    expect(stage.holdScroll).toHaveBeenCalledTimes(1)
  })

  it('another stage first closes what the last one opened, then drives the new one', () => {
    const { rerender } = renderHook(({ at }: { at: Stage }) => useStage(true, at, ''), {
      initialProps: { at: 'dish' as Stage },
    })
    expect(stage.closeStage).not.toHaveBeenCalled()
    rerender({ at: 'bill' })
    expect(stage.closeStage).toHaveBeenCalledTimes(1)
    expect(stage.closeStage.mock.invocationCallOrder[0]).toBeLessThan(
      stage.drive.mock.invocationCallOrder.at(-1) ?? 0,
    )
    expect(stage.drive).toHaveBeenLastCalledWith('bill', [])
    // A new focus on the same stage closes nothing.
    rerender({ at: 'bill' })
    expect(stage.closeStage).toHaveBeenCalledTimes(1)
  })

  it('drives its stage again once the frame has its services', () => {
    const { rerender } = renderHook(
      ({ services }: { services: boolean }) => useStage(true, 'bill', '', services),
      { initialProps: { services: false } },
    )
    expect(stage.drive).toHaveBeenCalledTimes(1)
    rerender({ services: true })
    expect(stage.stop).toHaveBeenCalledTimes(1)
    expect(stage.drive).toHaveBeenCalledTimes(2)
    expect(stage.drive).toHaveBeenLastCalledWith('bill', [])
    expect(stage.closeStage).not.toHaveBeenCalled()
  })

  it('a frame that never had a stage closes nothing and holds nothing', () => {
    const { rerender } = renderHook(
      ({ focus }: { focus: string }) => useStage(true, undefined, focus),
      {
        initialProps: { focus: '' },
      },
    )
    rerender({ focus: 'item' })
    expect(stage.closeStage).not.toHaveBeenCalled()
    expect(stage.holdScroll).not.toHaveBeenCalled()
    expect(stage.drive).toHaveBeenLastCalledWith('menu', ['item'])
  })
})
