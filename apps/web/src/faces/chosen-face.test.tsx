// @vitest-environment jsdom
// Drawing a template that loads on first use (brief SH-04): the skeleton while its code is on the
// way, the face once it arrived, and a short notice with another try when it could not be fetched.
import { buildViewModel, type FaceHostProps, imageSlotsFor, stringsFor } from '@restro/shell'
import { fixture } from '@restro/shell/testing'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ChosenFace, preloadFace } from './chosen-face'
import { type FaceEntry, faceEntry } from './registry'

const f = fixture('no-images')
const view = buildViewModel(f.snapshot, f.overlay, {
  ...f.context,
  locale: 'en_US',
  images: imageSlotsFor(faceEntry(null).manifest, 1),
})
const strings = stringsFor('en_US').guest

function Probe({ view: shown }: FaceHostProps) {
  return <p data-testid="probe">{shown.menu.title?.text ?? 'untitled'}</p>
}

/** A template of our own, with a loader we control (ids are unique: the app keeps one lazy per id). */
function entryWith(id: string, load: FaceEntry['load']): FaceEntry {
  return { ...faceEntry(null), id, load }
}

describe('ChosenFace', () => {
  it('shows the skeleton while the template loads, then the template with the host props', async () => {
    let arrive: (face: ComponentType<FaceHostProps>) => void = () => {}
    const entry = entryWith(
      'slow',
      () =>
        new Promise((resolve) => {
          arrive = resolve
        }),
    )
    render(<ChosenFace entry={entry} strings={strings} view={view} />)
    expect(screen.getByTestId('menu-skeleton')).toBeTruthy()
    expect(screen.queryByTestId('probe')).toBeNull()

    arrive(Probe)
    expect(await screen.findByTestId('probe')).toBeTruthy()
    expect(screen.queryByTestId('menu-skeleton')).toBeNull()
  })

  it('loads the template once, however often it is drawn', async () => {
    const load = vi.fn(async () => Probe)
    const entry = entryWith('once', load)
    const first = render(<ChosenFace entry={entry} strings={strings} view={view} />)
    await screen.findByTestId('probe')
    first.unmount()
    render(<ChosenFace entry={entry} strings={strings} view={view} />)
    await screen.findByTestId('probe')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('offers another try when the template cannot be fetched, and loads it again', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const load = vi
      .fn<FaceEntry['load']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(Probe)
    render(<ChosenFace entry={entryWith('flaky', load)} strings={strings} view={view} />)

    expect(await screen.findByText(strings.loadFailedTitle)).toBeTruthy()
    expect(screen.queryByTestId('probe')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: strings.retry }))
    expect(await screen.findByTestId('probe')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(2)
    error.mockRestore()
  })

  it('treats a template that throws while drawing like one that did not load', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Broken(): never {
      throw new Error('a bug in the face')
    }
    render(
      <ChosenFace entry={entryWith('broken', async () => Broken)} strings={strings} view={view} />,
    )
    expect(await screen.findByText(strings.loadFailedTitle)).toBeTruthy()
    error.mockRestore()
  })
})

describe('preloadFace', () => {
  it('starts the load and never throws, even when the load fails', async () => {
    const load = vi.fn(async () => {
      throw new Error('offline')
    })
    expect(() => preloadFace(entryWith('preloaded', load))).not.toThrow()
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
  })
})
