// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { toast } from 'sonner'
import { describe, expect, it } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog'
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
})
