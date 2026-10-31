'use client'

// My styles (D129): the organisation's own Styles beside Restro's premade ones, and the design in
// use at each of its other venues ("In use at {venue}"), so a venue copies another's look with one
// tap. The tiles are ticket 7's: a radio card with the real renderer drawing the top of this
// venue's menu with that Style's values, in this venue's colours and body font.
//
// A saved Style and a copy carry values only, never the colours, the Advanced roles, the logo or the
// body font (D128): those are the venue's brand, so picking any tile here leaves them alone. A copy
// is one-time; nothing links back.
//
// The writes are the organisation's, not the draft's, so they do not wait for Done: "Save as a
// style…" names and saves the draft's values at once, the "…" menu updates a Style with the current
// design or deletes it, and a delete's toast carries Undo (a restore through `apply`, D83: nothing
// is deleted from app code). None of them touches a venue's design.
//
// A member whose role may not change the design sees the group and the tiles, and neither the
// button nor the "…" menus.
import type {
  DesignValues,
  PremadeStyleId,
  SavedStyle,
  StyleValues,
  VenueTheme,
} from '@restro/core'
import { designValuesOfStyle, SAVED_STYLE_NAME_MAX, styleValuesOf } from '@restro/core'
import { MoreHorizontalIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useDeferredValue, useId, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { saveStyleAction, setStyleStatusAction } from '@/server/design/actions'
import type { MyStyles as MyStylesData, VenueStyle } from '@/server/design/styles'

import type { PickedStyle } from './design-draft'
import type { Draft } from './preview-draft'
import { specimenSnapshot } from './preview-snapshot'
import { StyleSpecimen } from './style-tiles'

/** One tile of the group: a Style of the organisation, or the design in use at one of its venues. */
type Entry =
  | { readonly kind: 'saved'; readonly key: string; readonly style: SavedStyle }
  | { readonly kind: 'venue'; readonly key: string; readonly venue: VenueStyle }

const entriesOf = (data: MyStylesData): Entry[] => [
  ...data.saved.map((style) => ({ kind: 'saved' as const, key: style.id, style })),
  ...data.venues.map((venue) => ({ kind: 'venue' as const, key: venue.venueId, venue })),
]

const isPicked = (picked: PickedStyle, entry: Entry): boolean =>
  entry.kind === 'saved'
    ? picked.kind === 'saved' && picked.id === entry.style.id
    : picked.kind === 'venue' && picked.venueId === entry.venue.venueId

export function MyStyles({
  venueId,
  data,
  groupName,
  picked,
  draft,
  theme,
  values,
  style,
  canEdit,
  onPick,
  onChanged,
}: {
  venueId: string
  data: MyStylesData
  /** The radio group the premade tiles share, so exactly one tile is ticked. */
  groupName: string
  picked: PickedStyle
  draft: Draft
  /** The draft's look, whole. */
  theme: VenueTheme
  /** The draft's values: what "Save as a style…" and Update store, and the body font the tiles draw in. */
  values: DesignValues
  /** The premade Style the draft's values came from. */
  style: PremadeStyleId
  canEdit: boolean
  onPick: (from: { style: PremadeStyleId; values: StyleValues }, picked: PickedStyle) => void
  /** Called after a save, an update, a delete or an Undo: the page reloads the list. */
  onChanged: () => void
}) {
  const t = useTranslations('design.myStyles')
  const nameId = useId()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [busy, startBusy] = useTransition()
  const entries = useMemo(() => entriesOf(data), [data])

  // Typing a colour must stay smooth: the pictures follow a moment later.
  const look = useDeferredValue(useMemo(() => ({ theme, values }), [theme, values]))
  const specimen = useMemo(
    () => (draft.state === 'ready' ? specimenSnapshot(draft.snapshot) : null),
    [draft],
  )

  /** The values the draft holds as a Style carries them: the body font dropped (D128). */
  const draftStyleValues = () => styleValuesOf(values)

  function run(
    work: Promise<{ ok: boolean; error?: string }>,
    done: (result: { ok: true; styleId?: string }) => void,
  ) {
    startBusy(async () => {
      const result = await work.catch(() => ({ ok: false, error: 'failed' }) as const)
      if (result.ok) {
        done(result as { ok: true; styleId?: string })
        onChanged()
        return
      }
      toast.error(t(`errors.${result.error ?? 'failed'}`))
    })
  }

  function onSave() {
    const trimmed = name.trim()
    if (trimmed.length === 0) return
    run(
      saveStyleAction({ styleId: null, name: trimmed, style, values: draftStyleValues() }),
      () => {
        setNaming(false)
        setName('')
        toast.success(t('saved'))
      },
    )
  }

  function onUpdate(saved: SavedStyle) {
    run(
      saveStyleAction({
        styleId: saved.id,
        name: saved.name,
        style,
        values: draftStyleValues(),
      }),
      () => toast.success(t('updated', { name: saved.name })),
    )
  }

  function onDelete(saved: SavedStyle) {
    run(setStyleStatusAction({ styleId: saved.id, status: 'removed' }), () => {
      toast.success(t('deleted'), {
        action: {
          label: t('undo'),
          onClick: () =>
            run(setStyleStatusAction({ styleId: saved.id, status: 'active' }), () =>
              toast.success(t('restored', { name: saved.name })),
            ),
        },
      })
    })
  }

  return (
    <div className="grid gap-3" data-testid="design-my-styles">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t('title')}
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {entries.map((entry) => {
          const label =
            entry.kind === 'saved' ? entry.style.name : t('inUse', { venue: entry.venue.venueName })
          const from = entry.kind === 'saved' ? entry.style : entry.venue
          const own = designValuesOfStyle(from.values, values.general.body_font)
          const ticked = isPicked(picked, entry)
          return (
            <div key={entry.key} className="relative grid min-w-0">
              <label
                data-testid="design-my-style-tile"
                data-style-id={entry.kind === 'saved' ? entry.style.id : undefined}
                data-venue-id={entry.kind === 'venue' ? entry.venue.venueId : undefined}
                className="grid cursor-pointer gap-2 rounded-md border p-2 has-checked:border-primary has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-70"
              >
                <div className="h-32 overflow-hidden rounded-sm bg-muted/40">
                  {specimen !== null && draft.state === 'ready' ? (
                    <StyleSpecimen
                      venueId={venueId}
                      slot={`my-style-${entry.key}`}
                      name={label}
                      snapshot={specimen}
                      overlay={draft.overlay}
                      theme={look.theme}
                      own={own}
                      testId="design-my-style-specimen"
                    />
                  ) : null}
                </div>
                <span className="flex min-h-8 min-w-0 items-center gap-2 pl-2 text-sm font-medium">
                  <input
                    type="radio"
                    name={groupName}
                    value={entry.key}
                    checked={ticked}
                    disabled={!canEdit}
                    // A click, not a change: picking the tile again fills its options in again.
                    onChange={() => undefined}
                    onClick={() =>
                      onPick(
                        { style: from.style as PremadeStyleId, values: from.values },
                        entry.kind === 'saved'
                          ? { kind: 'saved', id: entry.style.id }
                          : { kind: 'venue', venueId: entry.venue.venueId },
                      )
                    }
                    className="size-4 shrink-0 accent-primary"
                  />
                  {/* A long name wraps to two lines and is then cut; the whole one is the title. */}
                  <span title={label} className="line-clamp-2 min-w-0 [overflow-wrap:anywhere]">
                    {label}
                  </span>
                </span>
              </label>
              {entry.kind === 'saved' && canEdit ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy}
                      className="absolute end-1 top-1 bg-background/80"
                      aria-label={t('more', { name: entry.style.name })}
                      data-testid="design-my-style-menu"
                    >
                      <MoreHorizontalIcon aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      data-testid="design-my-style-update"
                      onSelect={() => onUpdate(entry.style)}
                    >
                      {t('update')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      data-testid="design-my-style-delete"
                      onSelect={() => onDelete(entry.style)}
                    >
                      {t('delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          )
        })}
      </div>

      {canEdit ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="justify-self-start"
          disabled={busy}
          onClick={() => setNaming(true)}
          data-testid="design-save-style"
        >
          {t('save')}
        </Button>
      ) : null}

      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent data-testid="design-save-style-dialog">
          <DialogHeader>
            <DialogTitle>{t('save')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={nameId}>{t('name')}</Label>
            <Input
              id={nameId}
              value={name}
              maxLength={SAVED_STYLE_NAME_MAX}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onSave()
                }
              }}
              data-testid="design-save-style-name"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNaming(false)}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              disabled={name.trim().length === 0 || busy}
              onClick={onSave}
              data-testid="design-save-style-confirm"
            >
              {t('saveButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
