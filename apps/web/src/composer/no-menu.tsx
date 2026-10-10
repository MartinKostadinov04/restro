'use client'

// A venue with no menu yet: say so, and offer to create the (empty) menu. The usual path is the
// operator setting the venue up; this keeps a venue without one from showing a blank tab.
import { LayoutListIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

import { createMenuAction } from './actions'

export function NoMenu({ venueId }: { venueId: string }) {
  const t = useTranslations('composer')
  const [pending, startTransition] = useTransition()

  function create() {
    startTransition(async () => {
      const result = await createMenuAction({ venueId }).catch(
        () => ({ ok: false, error: 'failed' }) as const,
      )
      if (!result.ok) toast.error(t(`errors.${result.error}`))
    })
  }

  return (
    <Empty className="min-h-72" data-testid="no-menu">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LayoutListIcon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{t('empty.noMenu.title')}</EmptyTitle>
        <EmptyDescription>{t('empty.noMenu.description')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" onClick={create} disabled={pending} data-testid="create-menu">
          {t('empty.noMenu.action')}
        </Button>
      </EmptyContent>
    </Empty>
  )
}
