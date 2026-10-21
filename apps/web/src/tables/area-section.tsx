'use client'

// One area of the venue in the Tables & QR tab (brief S5, D95): its name (editable by owners and
// admins), whether it is hidden, the menu its tables show unless they choose their own, and its
// tables as a grid of cards. On a venue made by hand the owner also adds tables here, and hides,
// moves and deletes the area; on a venue with a till the area is the till's hall: renamed,
// reordered and hidden, never created or deleted.
import {
  ArrowDownIcon,
  ArrowUpIcon,
  EyeIcon,
  EyeOffIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type FormEvent, useEffect, useId, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createTableAction,
  deleteAreaAction,
  moveAreaAction,
  renameAreaAction,
  setAreaHiddenAction,
} from '@/server/tables/actions'
import type { HallView, MenuChoice } from '@/server/tables/view'

import { ConfirmDialog } from './confirm-dialog'
import { RoutePicker } from './route-picker'
import { TableCard } from './table-card'
import { useRun } from './use-run'

export function AreaSection({
  hall,
  index,
  count,
  venueId,
  canManage,
  fromTill,
  menus,
  areas,
}: {
  hall: HallView
  /** The area's place among the venue's areas, and how many areas there are. */
  index: number
  count: number
  venueId: string
  canManage: boolean
  fromTill: boolean
  menus: readonly MenuChoice[]
  /** Every area of the venue, in order: "Move to …" on a table lists the others. */
  areas: readonly { readonly id: string; readonly name: string; readonly tableCount: number }[]
}) {
  const t = useTranslations('tables')
  const { pending, run } = useRun()
  const nameId = useId()
  const [name, setName] = useState(hall.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newNumber, setNewNumber] = useState('')
  const [newName, setNewName] = useState('')

  // After a change the page brings the saved name back; show it.
  useEffect(() => setName(hall.name), [hall.name])

  function saveName() {
    const next = name.trim().replace(/\s+/g, ' ')
    if (next === hall.name) return
    if (next === '') {
      setName(hall.name)
      return
    }
    run(
      () => renameAreaAction({ venueId, areaId: hall.id, name: next }),
      t('area.nameSaved'),
      (ok) => {
        if (!ok) setName(hall.name)
      },
    )
  }

  function addTable(event: FormEvent) {
    event.preventDefault()
    run(
      () =>
        createTableAction({
          venueId,
          areaId: hall.id,
          number: newNumber.trim() === '' ? null : newNumber,
          name: newName.trim() === '' ? null : newName,
        }),
      t('addTable.done'),
      (ok) => {
        if (!ok) return
        setNewNumber('')
        setNewName('')
        setAdding(false)
      },
    )
  }

  const otherAreas = areas.filter((area) => area.id !== hall.id)

  return (
    <section
      className="space-y-3"
      data-testid="hall"
      data-area-id={hall.id}
      data-hidden={!hall.isPublic}
      aria-label={hall.name}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="grid min-w-0 gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {canManage ? (
              <>
                <Label htmlFor={nameId} className="sr-only">
                  {t('area.nameLabel')}
                </Label>
                <Input
                  id={nameId}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onBlur={saveName}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') setName(hall.name)
                  }}
                  maxLength={60}
                  disabled={pending}
                  autoComplete="off"
                  className="h-9 w-56 max-w-full font-semibold"
                  data-testid="hall-name"
                />
              </>
            ) : (
              <h3 className="text-sm font-semibold" data-testid="hall-name">
                {hall.name}
              </h3>
            )}
            {hall.isPublic ? null : (
              <Badge variant="outline" title={t('area.hiddenHelp')} data-testid="hall-hidden">
                {t('area.hidden')}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground" data-testid="hall-count">
              {t('halls.count', { count: hall.tables.length })}
            </span>
          </div>
          <RoutePicker
            venueId={venueId}
            target={{ areaId: hall.id }}
            targetName={t('route.area', { name: hall.name })}
            menus={menus}
            value={hall.routeMenuId}
            effective={hall.menu}
            canManage={canManage}
          />
        </div>

        {canManage ? (
          <div className="flex items-center gap-1">
            {fromTill ? null : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => setAdding((open) => !open)}
                data-testid="add-table"
              >
                <PlusIcon aria-hidden />
                {t('area.addTable')}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t('area.actions', { name: hall.name })}
                  disabled={pending}
                  data-testid="hall-menu"
                >
                  <MoreHorizontalIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                <DropdownMenuItem
                  onSelect={() =>
                    run(
                      () =>
                        setAreaHiddenAction({
                          venueId,
                          areaId: hall.id,
                          hidden: hall.isPublic,
                        }),
                      hall.isPublic ? t('area.hiddenDone') : t('area.shownDone'),
                    )
                  }
                  data-testid="toggle-hall-hidden"
                >
                  {hall.isPublic ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
                  {hall.isPublic ? t('area.hide') : t('area.show')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={index === 0}
                  onSelect={() =>
                    run(
                      () => moveAreaAction({ venueId, areaId: hall.id, position: index - 1 }),
                      t('area.moved'),
                    )
                  }
                  data-testid="move-hall-up"
                >
                  <ArrowUpIcon aria-hidden />
                  {t('area.moveUp')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={index >= count - 1}
                  onSelect={() =>
                    run(
                      () => moveAreaAction({ venueId, areaId: hall.id, position: index + 1 }),
                      t('area.moved'),
                    )
                  }
                  data-testid="move-hall-down"
                >
                  <ArrowDownIcon aria-hidden />
                  {t('area.moveDown')}
                </DropdownMenuItem>
                {fromTill ? null : (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => setConfirmDelete(true)}
                      data-testid="delete-hall"
                    >
                      <Trash2Icon aria-hidden />
                      {t('area.delete')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>

      {adding && canManage && !fromTill ? (
        <form
          onSubmit={addTable}
          className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/40 p-3"
          aria-label={t('addTable.title', { area: hall.name })}
          data-testid="add-table-form"
        >
          <div className="grid gap-1">
            <Label htmlFor={`${nameId}-number`} className="text-xs">
              {t('addTable.number')}
            </Label>
            <Input
              id={`${nameId}-number`}
              value={newNumber}
              onChange={(event) => setNewNumber(event.target.value)}
              maxLength={40}
              autoComplete="off"
              className="h-9 w-28"
              data-testid="new-table-number"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${nameId}-name`} className="text-xs">
              {t('addTable.name')}
            </Label>
            <Input
              id={`${nameId}-name`}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              maxLength={40}
              autoComplete="off"
              className="h-9 w-56 max-w-full"
              data-testid="new-table-name"
            />
          </div>
          <Button
            type="submit"
            size="sm"
            disabled={pending || (newNumber.trim() === '' && newName.trim() === '')}
            data-testid="new-table-submit"
          >
            {t('addTable.button')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
            {t('cancel')}
          </Button>
        </form>
      ) : null}

      {hall.tables.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="hall-empty">
          {t('area.noTables')}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {hall.tables.map((row, position) => (
            <TableCard
              key={row.id}
              row={row}
              venueId={venueId}
              canManage={canManage}
              fromTill={fromTill}
              areaPublic={hall.isPublic}
              menus={menus}
              otherAreas={otherAreas}
              index={position}
              count={hall.tables.length}
            />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('confirmDeleteArea.title', { name: hall.name })}
        description={t('confirmDeleteArea.description')}
        confirmLabel={t('confirmDeleteArea.confirm')}
        pending={pending}
        testId="confirm-delete-area"
        onConfirm={() =>
          run(
            () => deleteAreaAction({ venueId, areaId: hall.id }),
            t('area.deleted'),
            () => setConfirmDelete(false),
          )
        }
      />
    </section>
  )
}
