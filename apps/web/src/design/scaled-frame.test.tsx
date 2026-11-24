// @vitest-environment jsdom
// A tile's frame and its placeholder (D159): the quiet placeholder stays over a part's frame until
// the part has told a height above 0, not only until the frame's page has loaded, and comes back when
// the part draws nothing. The live preview's frame (no `onHeight`) drops it once loaded.
import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import type { FrameStore } from './preview-frames'
import { ScaledFrame } from './scaled-frame'

/** The store the Design page keeps for a slot, as its frame's page reaches it. */
const storeOf = (slot: string) =>
  (window as unknown as { __restroDesignFrames: Map<string, FrameStore> }).__restroDesignFrames.get(
    slot,
  )

describe('the placeholder over a frame', () => {
  it("a part's frame keeps it until the part has drawn, and shows it again for nothing drawn", () => {
    const onHeight = vi.fn()
    renderWithIntl(
      <ScaledFrame
        venueId="vn_test"
        slot="tile-test"
        width={320}
        title="Picture"
        content={null}
        picture
        testId="frame"
        onHeight={onHeight}
      />,
    )
    fireEvent.load(screen.getByTestId('frame'))
    expect(screen.queryByTestId('design-tile-loading')).not.toBeNull()

    act(() => storeOf('tile-test')?.size(120))
    expect(onHeight).toHaveBeenLastCalledWith(120)
    expect(screen.queryByTestId('design-tile-loading')).toBeNull()

    act(() => storeOf('tile-test')?.size(0))
    expect(onHeight).toHaveBeenLastCalledWith(0)
    expect(screen.queryByTestId('design-tile-loading')).not.toBeNull()
  })

  it('a frame of the whole menu drops it once its page has loaded', () => {
    renderWithIntl(
      <ScaledFrame
        venueId="vn_test"
        slot="menu-test"
        width={320}
        title="Menu"
        content={null}
        picture
        testId="frame"
      />,
    )
    expect(screen.queryByTestId('design-tile-loading')).not.toBeNull()
    fireEvent.load(screen.getByTestId('frame'))
    expect(screen.queryByTestId('design-tile-loading')).toBeNull()
  })
})
