// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './sheet'
import { Toaster } from './sonner'

describe('the toaster', () => {
  it('takes pointer events back while a modal dialog holds them off the body', async () => {
    renderWithIntl(
      <>
        <Toaster />
        <Dialog open>
          <DialogContent>
            <DialogTitle>Sheet</DialogTitle>
            <DialogDescription>Open</DialogDescription>
          </DialogContent>
        </Dialog>
      </>,
    )
    toast('Saved')
    const toaster = await screen.findByText('Saved')
    const list = toaster.closest('[data-sonner-toaster]') as HTMLElement
    expect(list.style.pointerEvents).toBe('auto')
  })

  it('a click on a toast does not close the sheet or the dialog that is open', async () => {
    const closeSheet = vi.fn()
    const closeDialog = vi.fn()
    renderWithIntl(
      <>
        <Toaster />
        <Sheet open onOpenChange={closeSheet}>
          <SheetContent>
            <SheetTitle>Sheet</SheetTitle>
            <SheetDescription>Open</SheetDescription>
          </SheetContent>
        </Sheet>
        <Dialog open onOpenChange={closeDialog}>
          <DialogContent>
            <DialogTitle>Dialog</DialogTitle>
            <DialogDescription>Open</DialogDescription>
          </DialogContent>
        </Dialog>
      </>,
    )
    const undone = vi.fn()
    toast('Saved', { action: { label: 'Undo', onClick: undone } })
    const undo = await screen.findByRole('button', { name: 'Undo' })
    await userEvent.click(undo)
    expect(undone).toHaveBeenCalledTimes(1)
    expect(closeSheet).not.toHaveBeenCalled()
    expect(closeDialog).not.toHaveBeenCalled()
  })

  it('a click elsewhere outside the sheet still closes it', async () => {
    const close = vi.fn()
    renderWithIntl(
      <>
        <button type="button">Elsewhere</button>
        <Sheet open onOpenChange={close}>
          <SheetContent>
            <SheetTitle>Sheet</SheetTitle>
            <SheetDescription>Open</SheetDescription>
          </SheetContent>
        </Sheet>
      </>,
    )
    document.body.style.pointerEvents = 'auto'
    await userEvent.click(document.querySelector('[data-slot="sheet-overlay"]') as Element)
    expect(close).toHaveBeenCalledWith(false)
  })
})
