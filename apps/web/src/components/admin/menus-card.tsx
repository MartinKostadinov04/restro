'use client'

// The venue's menus in Settings › General (D88, D90, D91; adjustments M1). One row per menu in the
// venue's order: its header name (none = the venue's name), the Live badge, ">" into the composer
// on that menu, rename in place, move up and down, and "Set live", which publishes the menu once
// the person confirms (D90). A hand-made venue also adds menus, deletes them (to the bin; the live
// one is refused: choose another first) and imports one from another hand-made venue; a venue fed
// by a till gets its menus from the till (D88), so it has none of the three. Deleted menus wait in
// a collapsed list, with the day they were deleted and Restore, until the purge erases them.
// Owners and admins act; everyone else sees the list.
import {
  ArchiveRestoreIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ImportIcon,
  PencilIcon,
  PlusIcon,
  RadioIcon,
  Trash2Icon,
} from 'lucide-react'
import Link from 'next/link'
import { useFormatter, useTranslations } from 'next-intl'
import { type FormEvent, useEffect, useId, useState, useTransition } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FormSection } from '@/components/ui/form-section'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  createMenuAction,
  deleteMenuAction,
  type ImportSource,
  importMenuAction,
  listImportSourcesAction,
  type MenuActionResult,
  moveMenuAction,
  renameMenuAction,
  restoreMenuAction,
  setLiveMenuAction,
} from '@/server/menus-actions'

/** A menu as the card shows it (core's `MenuSummary`, the fields it needs). */
export interface MenuRow {
  readonly id: string
  /** The header name; null = the venue's name. */
  readonly name: string | null
  readonly live: boolean
  /** When it went to the bin (ISO 8601); null = in use. */
  readonly deletedAt: string | null
}

type ActionError = Extract<MenuActionResult, { ok: false }>['error']

/** Where a menu opens in the composer (S6 reads `menu`). */
export const composerMenuHref = (venueId: string, menuId: string) =>
  `/venues/${venueId}?tab=studio&menu=${menuId}`

const DAY_MS = 24 * 60 * 60 * 1000

function MenuName({ name, venueName }: { name: string | null; venueName: string }) {
  const t = useTranslations('venueMenus')
  return name === null ? (
    <span>
      {venueName} <span className="text-xs text-muted-foreground">{t('venueNameNote')}</span>
    </span>
  ) : (
    <span>{name}</span>
  )
}

/** The rename field of one row. */
function RenameForm({
  menu,
  venueName,
  pending,
  onSave,
  onCancel,
}: {
  menu: MenuRow
  venueName: string
  pending: boolean
  onSave: (name: string) => void
  onCancel: () => void
}) {
  const t = useTranslations('venueMenus')
  const id = useId()
  const [value, setValue] = useState(menu.name ?? '')
  function submit(event: FormEvent) {
    event.preventDefault()
    onSave(value)
  }
  return (
    <form onSubmit={submit} className="flex flex-1 flex-wrap items-center gap-2">
      <Label htmlFor={id} className="sr-only">
        {t('rename.label')}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={venueName}
        className="h-8 max-w-xs"
        autoFocus
        data-testid="menu-rename-input"
      />
      <Button type="submit" size="sm" disabled={pending} data-testid="menu-rename-save">
        {t('rename.save')}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        {t('cancel')}
      </Button>
      <p className="basis-full text-xs text-muted-foreground">{t('rename.help')}</p>
    </form>
  )
}

/** "Import from another venue": a hand-made venue, one of its menus, and a name for the copy. */
function ImportDialog({
  venueId,
  open,
  onOpenChange,
  onDone,
}: {
  venueId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: (error: ActionError | null) => void
}) {
  const t = useTranslations('venueMenus.import')
  const id = useId()
  const [sources, setSources] = useState<readonly ImportSource[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [fromVenue, setFromVenue] = useState('')
  const [fromMenu, setFromMenu] = useState('')
  const [name, setName] = useState('')
  const [loading, startLoading] = useTransition()
  const [pending, startImport] = useTransition()

  // Each time it opens the venues are read again: another venue may have a new menu by now.
  useEffect(() => {
    if (!open) return
    setFailed(false)
    setFromVenue('')
    setFromMenu('')
    setName('')
    startLoading(async () => {
      const result = await listImportSourcesAction(venueId)
      if (result.ok) setSources(result.venues)
      else setFailed(true)
    })
  }, [open, venueId])

  const venue = sources?.find((source) => source.venueId === fromVenue)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (fromVenue === '' || fromMenu === '') return
    startImport(async () => {
      const result = await importMenuAction({
        fromVenueId: fromVenue,
        fromMenuId: fromMenu,
        toVenueId: venueId,
        ...(name.trim() === '' ? {} : { name }),
      })
      onDone(result.ok ? null : result.error)
      if (result.ok) onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="menu-import-dialog">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          {loading || (sources === null && !failed) ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('loading')}
            </p>
          ) : failed ? (
            <p role="alert" className="text-sm text-destructive">
              {t('loadFailed')}
            </p>
          ) : sources !== null && sources.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="menu-import-none">
              {t('none')}
            </p>
          ) : (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-venue`}>{t('venue')}</Label>
                <Select
                  value={fromVenue}
                  onValueChange={(value) => {
                    setFromVenue(value)
                    setFromMenu('')
                  }}
                >
                  <SelectTrigger id={`${id}-venue`} data-testid="menu-import-venue">
                    <SelectValue placeholder={t('venuePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {(sources ?? []).map((source) => (
                      <SelectItem key={source.venueId} value={source.venueId}>
                        {source.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-menu`}>{t('menu')}</Label>
                <Select value={fromMenu} onValueChange={setFromMenu} disabled={venue === undefined}>
                  <SelectTrigger id={`${id}-menu`} data-testid="menu-import-menu">
                    <SelectValue placeholder={t('menuPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {(venue?.menus ?? []).map((menu) => (
                      <SelectItem key={menu.id} value={menu.id}>
                        {menu.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-name`}>{t('name')}</Label>
                <Input
                  id={`${id}-name`}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t('namePlaceholder')}
                  data-testid="menu-import-name"
                />
              </div>
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              disabled={pending || fromVenue === '' || fromMenu === ''}
              data-testid="menu-import-submit"
            >
              {pending ? t('importing') : t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function MenusCard({
  venueId,
  venueName,
  hasTill,
  canManage,
  menus,
  deleted,
  binDays,
  timeZone,
}: {
  venueId: string
  venueName: string
  /** A till feeds the venue: its menus are the till's (no add, delete or import, D88). */
  hasTill: boolean
  /** Owner or admin. */
  canManage: boolean
  /** The menus in use, in order. */
  menus: readonly MenuRow[]
  /** The binned menus, most recently deleted first. */
  deleted: readonly MenuRow[]
  /** Days a binned menu waits before the purge erases it. */
  binDays: number
  /** The venue's time zone: the days are the venue's. */
  timeZone: string
}) {
  const t = useTranslations('venueMenus')
  const format = useFormatter()
  const addId = useId()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<ActionError | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [settingLive, setSettingLive] = useState<MenuRow | null>(null)
  const [importing, setImporting] = useState(false)
  const [binOpen, setBinOpen] = useState(false)
  const handMade = !hasTill

  /** Runs an action; the page refreshes itself when it worked (the actions revalidate it). */
  function act(run: () => Promise<{ ok: boolean; error?: ActionError }>, done?: string) {
    setError(null)
    setNote(null)
    startTransition(async () => {
      const result = await run()
      if (result.ok) {
        if (done !== undefined) setNote(done)
      } else setError(result.error ?? 'failed')
    })
  }

  function move(menu: MenuRow, by: -1 | 1) {
    const index = menus.findIndex((row) => row.id === menu.id)
    const target = index + by
    if (index < 0 || target < 0 || target >= menus.length) return
    // Up: just before the menu above. Down: just before the one after the menu below, or the end.
    const before = by === -1 ? menus[target] : menus[target + 1]
    act(() =>
      moveMenuAction({
        venueId,
        menuId: menu.id,
        position: before === undefined ? 'end' : { before: before.id },
      }),
    )
  }

  function add(event: FormEvent) {
    event.preventDefault()
    act(async () => {
      const result = await createMenuAction({ venueId, name: newName })
      if (result.ok) {
        setAdding(false)
        setNewName('')
      }
      return result
    }, t('added'))
  }

  const day = (at: Date) => format.dateTime(at, { dateStyle: 'medium', timeZone })
  const purgeDate = (deletedAt: string) => day(new Date(Date.parse(deletedAt) + binDays * DAY_MS))

  return (
    <FormSection title={t('title')} description={hasTill ? t('descriptionTill') : t('description')}>
      <ol className="divide-y rounded-md border" data-testid="menus-list">
        {menus.map((menu, index) => (
          <li
            key={menu.id}
            className="flex flex-wrap items-center gap-2 px-3 py-2"
            data-testid="menu-row"
            data-menu={menu.id}
            data-live={menu.live ? 'true' : 'false'}
          >
            {renaming === menu.id ? (
              <RenameForm
                menu={menu}
                venueName={venueName}
                pending={pending}
                onCancel={() => setRenaming(null)}
                onSave={(name) =>
                  act(async () => {
                    const result = await renameMenuAction({ venueId, menuId: menu.id, name })
                    if (result.ok) setRenaming(null)
                    return result
                  })
                }
              />
            ) : (
              <>
                <span className="flex min-w-0 flex-1 items-center gap-2 font-medium">
                  <MenuName name={menu.name} venueName={venueName} />
                  {menu.live ? (
                    <Badge variant="success" data-testid="menu-live-badge">
                      {t('live')}
                    </Badge>
                  ) : null}
                </span>
                {canManage ? (
                  <span className="flex flex-wrap items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={pending}
                      onClick={() => setRenaming(menu.id)}
                      data-testid="menu-rename"
                    >
                      <PencilIcon aria-hidden />
                      <span className="sr-only">{t('rename.open')}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={pending || index === 0}
                      onClick={() => move(menu, -1)}
                      data-testid="menu-up"
                    >
                      <ArrowUpIcon aria-hidden />
                      <span className="sr-only">{t('up')}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={pending || index === menus.length - 1}
                      onClick={() => move(menu, 1)}
                      data-testid="menu-down"
                    >
                      <ArrowDownIcon aria-hidden />
                      <span className="sr-only">{t('down')}</span>
                    </Button>
                    {menu.live ? null : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => setSettingLive(menu)}
                        data-testid="menu-set-live"
                      >
                        <RadioIcon aria-hidden />
                        {t('setLive.open')}
                      </Button>
                    )}
                    {handMade ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={pending || menu.live}
                        title={menu.live ? t('deleteLive') : undefined}
                        onClick={() =>
                          act(() => deleteMenuAction({ venueId, menuId: menu.id }), t('deleted'))
                        }
                        data-testid="menu-delete"
                      >
                        <Trash2Icon aria-hidden />
                        {t('delete')}
                      </Button>
                    ) : null}
                  </span>
                ) : null}
                <Button asChild variant="ghost" size="icon-sm">
                  <Link
                    href={composerMenuHref(venueId, menu.id)}
                    aria-label={t('open', { name: menu.name ?? venueName })}
                    data-testid="menu-open"
                  >
                    <ChevronRightIcon aria-hidden />
                  </Link>
                </Button>
              </>
            )}
          </li>
        ))}
        {menus.length === 0 ? (
          <li className="px-3 py-2 text-sm text-muted-foreground" data-testid="menus-empty">
            {hasTill ? t('emptyTill') : t('empty')}
          </li>
        ) : null}
      </ol>
      {canManage && handMade && menus.some((menu) => menu.live) ? (
        <p className="text-xs text-muted-foreground">{t('deleteLive')}</p>
      ) : null}

      {canManage && handMade ? (
        <div className="flex flex-wrap items-center gap-2">
          {adding ? (
            <form onSubmit={add} className="flex flex-wrap items-center gap-2">
              <Label htmlFor={addId} className="sr-only">
                {t('add.label')}
              </Label>
              <Input
                id={addId}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder={t('add.placeholder', { name: venueName })}
                className="h-8 max-w-xs"
                autoFocus
                data-testid="menu-add-name"
              />
              <Button type="submit" size="sm" disabled={pending} data-testid="menu-add-submit">
                {t('add.submit')}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                {t('cancel')}
              </Button>
            </form>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setAdding(true)}
              data-testid="menu-add"
            >
              <PlusIcon aria-hidden />
              {t('add.open')}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => setImporting(true)}
            data-testid="menu-import"
          >
            <ImportIcon aria-hidden />
            {t('import.open')}
          </Button>
        </div>
      ) : null}

      {error !== null ? (
        <p role="alert" className="text-sm text-destructive" data-testid="menus-error">
          {t(`errors.${error}`)}
        </p>
      ) : null}
      {note !== null ? (
        <p role="status" className="text-sm text-muted-foreground" data-testid="menus-note">
          {note}
        </p>
      ) : null}

      {handMade && deleted.length > 0 ? (
        <Collapsible open={binOpen} onOpenChange={setBinOpen} className="grid gap-2">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-fit"
              data-testid="menus-bin-toggle"
            >
              {binOpen ? <ChevronUpIcon aria-hidden /> : <ChevronDownIcon aria-hidden />}
              {t('bin.title', { count: deleted.length })}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="mb-2 text-xs text-muted-foreground">
              {t('bin.description', { days: binDays })}
            </p>
            <ul className="divide-y rounded-md border" data-testid="menus-bin">
              {deleted.map((menu) => (
                <li
                  key={menu.id}
                  className="flex flex-wrap items-center gap-2 px-3 py-2"
                  data-testid="menu-binned"
                  data-menu={menu.id}
                >
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <MenuName name={menu.name} venueName={venueName} />
                    {menu.deletedAt !== null ? (
                      <span className="text-xs text-muted-foreground">
                        {t('bin.when', {
                          deleted: day(new Date(menu.deletedAt)),
                          erased: purgeDate(menu.deletedAt),
                        })}
                      </span>
                    ) : null}
                  </span>
                  {canManage ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        act(() => restoreMenuAction({ venueId, menuId: menu.id }), t('restored'))
                      }
                      data-testid="menu-restore"
                    >
                      <ArchiveRestoreIcon aria-hidden />
                      {t('bin.restore')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      <Dialog
        open={settingLive !== null}
        onOpenChange={(open) => (open ? null : setSettingLive(null))}
      >
        <DialogContent data-testid="menu-set-live-dialog">
          <DialogHeader>
            <DialogTitle>
              {t('setLive.title', { name: settingLive?.name ?? venueName })}
            </DialogTitle>
            <DialogDescription>{t('setLive.description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSettingLive(null)}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() => {
                const menu = settingLive
                if (menu === null) return
                setSettingLive(null)
                act(async () => {
                  const result = await setLiveMenuAction({ venueId, menuId: menu.id })
                  if (result.ok) setNote(result.queued ? t('setLive.done') : t('setLive.notQueued'))
                  return result
                })
              }}
              data-testid="menu-set-live-confirm"
            >
              {t('setLive.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {canManage && handMade ? (
        <ImportDialog
          venueId={venueId}
          open={importing}
          onOpenChange={setImporting}
          onDone={(failure) => {
            if (failure === null) setNote(t('imported'))
            else setError(failure)
          }}
        />
      ) : null}
    </FormSection>
  )
}
