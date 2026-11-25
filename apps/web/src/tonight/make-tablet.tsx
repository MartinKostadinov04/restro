'use client'

// "Make this the bar tablet" on Tonight (RR-O35, Martin 11-06: the bar tablet signs in with a
// staff-only account). Drawn only for such an account, on a browser that is not shared yet: it names
// the device and makes this session the venue's shared device (`device.mark_shared`, which refuses
// every other account again, with the password of the last 15 minutes: asked here when it is
// older). Then the page reloads as the shared device, which asks a PIN for every action.
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WRAPS_FORM } from '@/lib/wrapping'
import { markSharedDeviceAction } from '@/server/settings/staff-actions'
import { useSettingsRun } from '@/settings/use-settings-run'

export function MakeTablet({ venueId, email }: { venueId: string; email: string }) {
  const t = useTranslations('ownerSettings')
  const router = useRouter()
  const { pending, run, dialog } = useSettingsRun(email)
  const [making, setMaking] = useState(false)
  const [name, setName] = useState('')

  return (
    <div data-testid="make-tablet">
      <Button variant="outline" size="sm" className={WRAPS_FORM} onClick={() => setMaking(true)}>
        {t('sf_dev_tablet')}
      </Button>
      <Dialog open={making} onOpenChange={setMaking}>
        <DialogContent>
          <form
            className="grid grid-cols-1 gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (name.trim() === '') return
              setMaking(false)
              run(() => markSharedDeviceAction({ venueId, name: name.trim() }), {
                done: t('st_saved'),
                words: (error) => (error === 'already_shared' ? t('sf_e_shared') : undefined),
                onOk: () => {
                  setName('')
                  router.refresh()
                },
              })
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('sf_dev_tablet')}</DialogTitle>
              <DialogDescription>{t('sf_dev_line')}</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-2">
              <Label htmlFor="tablet-name">{t('sf_dev_name')}</Label>
              <Input
                id="tablet-name"
                value={name}
                maxLength={40}
                autoFocus
                placeholder={t('sf_dev_example')}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setMaking(false)}>
                {t('st_cancel')}
              </Button>
              <Button type="submit" disabled={pending || name.trim() === ''}>
                {t('sf_dev_go')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {dialog}
    </div>
  )
}
