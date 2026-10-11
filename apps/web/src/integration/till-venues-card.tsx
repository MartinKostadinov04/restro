'use client'

// The list of venues the installation reports (D73, T68): every one with its state and one thing
// to do about it.
//
//   linked      "Linked to «venue»": a link to that venue's Settings, where its menu category is
//               chosen (the list says when it still has to be);
//   unlinked    "Add as venue" (makes a venue of ours named after it and sends the person to its
//               Menu source card), "Link to an existing venue" (only venues that have no link
//               yet, after the same warning as the venue's own "Change…") and "Not used";
//   not used    set aside (a shop, catering, "Services"); "Use again" brings it back.
//
// A till venue's own number is only handed back to the server actions; it is never drawn. Owners
// and admins act; everyone else sees the list.
import { PlugIcon, StoreIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useId, useState, useTransition } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { FormSection } from '@/components/ui/form-section'
import {
  addTillVenueAsVenueAction,
  linkTillVenueAction,
  markTillVenueAction,
} from '@/server/integration/actions'
import type { IntegrationErrorCode, IntegrationView, TillVenueRow } from '@/server/integration/view'

import { ErrorNote } from './error-note'

/** Where a venue's Menu source card is: its Settings tab. */
export function menuSourceHref(venueId: string): string {
  return `/venues/${venueId}?tab=settings#menu-source`
}

function VenueRow({
  row,
  view,
  busy,
  onAdd,
  onLink,
  onMark,
}: {
  row: TillVenueRow
  view: IntegrationView
  busy: boolean
  onAdd: (row: TillVenueRow) => void
  onLink: (row: TillVenueRow) => void
  onMark: (row: TillVenueRow, notUsed: boolean) => void
}) {
  const t = useTranslations('integration.tillVenues')
  const editable = view.canManage

  return (
    <li
      className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4"
      data-testid="till-venue"
      data-state={row.state}
    >
      <div className="grid gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium" data-testid="till-venue-name">
            {row.name}
          </span>
          {row.state === 'not_used' ? (
            <Badge variant="secondary" data-testid="till-venue-not-used">
              {t('state.not_used')}
            </Badge>
          ) : null}
        </span>
        {row.address ? (
          <span className="text-xs text-muted-foreground" data-testid="venue-address">
            {row.address}
          </span>
        ) : null}
        {row.publicMenuSetUp ? (
          <span className="text-xs text-muted-foreground" data-testid="venue-public-menu">
            {t('publicMenu')}
          </span>
        ) : null}
        {row.state === 'linked' && row.venue ? (
          <span className="text-sm">
            <Link
              href={menuSourceHref(row.venue.id)}
              className="text-primary underline-offset-4 hover:underline"
              data-testid="till-venue-linked"
            >
              {t('state.linked', { venue: row.venue.name })}
            </Link>
            {row.hasMenuCategory ? null : (
              <span className="ms-2 text-xs text-warning" data-testid="till-venue-needs-category">
                {t('needsCategory')}
              </span>
            )}
          </span>
        ) : null}
        {row.state === 'unlinked' ? (
          <span className="text-xs text-muted-foreground">{t('state.unlinked')}</span>
        ) : null}
      </div>
      {editable && row.state === 'unlinked' ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={() => onAdd(row)}>
            {t('actions.add')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || view.linkableVenues.length === 0}
            onClick={() => onLink(row)}
          >
            {t('actions.link')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onMark(row, true)}
          >
            {t('actions.notUsed')}
          </Button>
        </div>
      ) : null}
      {editable && row.state === 'not_used' ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onMark(row, false)}
          >
            {t('actions.useAgain')}
          </Button>
        </div>
      ) : null}
    </li>
  )
}

/** "Link to an existing venue": choose one of the venues that have no link, after the warning. */
function LinkDialog({
  row,
  view,
  onClose,
  onError,
}: {
  row: TillVenueRow | null
  view: IntegrationView
  onClose: () => void
  onError: (error: IntegrationErrorCode) => void
}) {
  const t = useTranslations('integration.tillVenues.linkDialog')
  const groupName = useId()
  const [chosen, setChosen] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function confirm() {
    if (row === null || chosen === null) return
    startTransition(async () => {
      const result = await linkTillVenueAction({ bid: row.key, venueId: chosen })
      if (!result.ok) onError(result.error)
      setChosen(null)
      onClose()
    })
  }

  return (
    <Dialog
      open={row !== null}
      onOpenChange={(open) => {
        if (!open && !pending) {
          setChosen(null)
          onClose()
        }
      }}
    >
      {row !== null ? (
        <DialogContent data-testid="link-dialog">
          <DialogHeader>
            <DialogTitle>{t('title', { name: row.name })}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          <fieldset className="grid gap-2" disabled={pending}>
            <legend className="sr-only">{t('legend')}</legend>
            {view.linkableVenues.map((venue) => (
              <label
                key={venue.id}
                className="flex items-center gap-3 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent"
              >
                <input
                  type="radio"
                  name={groupName}
                  className="size-4 accent-primary"
                  checked={chosen === venue.id}
                  onChange={() => setChosen(venue.id)}
                />
                <span className="font-medium">{venue.name}</span>
              </label>
            ))}
          </fieldset>
          <p className="text-sm text-muted-foreground" data-testid="link-warning">
            {t('warning')}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button type="button" disabled={pending || chosen === null} onClick={confirm}>
              {pending ? t('linking') : t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

export function TillVenuesCard({ view }: { view: IntegrationView }) {
  const t = useTranslations('integration.tillVenues')
  const router = useRouter()
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [linking, setLinking] = useState<TillVenueRow | null>(null)
  const [pending, startTransition] = useTransition()

  const todo = view.tillVenues.filter((row) => row.state === 'unlinked').length

  function add(row: TillVenueRow) {
    setError(null)
    startTransition(async () => {
      const result = await addTillVenueAsVenueAction({ bid: row.key })
      if (!result.ok) {
        setError(result.error)
        return
      }
      // The new venue's Menu source card is where the menu category is chosen.
      if (result.venueId) router.push(menuSourceHref(result.venueId))
    })
  }

  function mark(row: TillVenueRow, notUsed: boolean) {
    setError(null)
    startTransition(async () => {
      const result = await markTillVenueAction({ bid: row.key, notUsed })
      if (!result.ok) setError(result.error)
    })
  }

  return (
    <FormSection title={t('title')} description={t('description')}>
      {view.tillVenues.length === 0 ? (
        <Empty className="min-h-40" data-testid="till-venues-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {view.integration ? <StoreIcon aria-hidden /> : <PlugIcon aria-hidden />}
            </EmptyMedia>
            <EmptyTitle>{t('empty.title')}</EmptyTitle>
            <EmptyDescription>{t('empty.description')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="till-venues-todo">
            {todo === 0 ? t('allDone') : t('todo', { count: todo })}
          </p>
          <ul className="divide-y" data-testid="till-venues">
            {view.tillVenues.map((row) => (
              <VenueRow
                key={row.key}
                row={row}
                view={view}
                busy={pending}
                onAdd={add}
                onLink={(target) => {
                  setError(null)
                  setLinking(target)
                }}
                onMark={mark}
              />
            ))}
          </ul>
        </>
      )}
      <ErrorNote code={error} />
      <LinkDialog row={linking} view={view} onClose={() => setLinking(null)} onError={setError} />
    </FormSection>
  )
}
