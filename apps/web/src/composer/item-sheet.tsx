'use client'

// The item sheet (brief S2-06b): the side Sheet the composer opens for one item, with the tabs
// Details, Translations, Media and History. Ported from the Platform's builder (Ontology/Show.jsx
// and RenderGraph.jsx: a side Sheet with tabs next to the tree); changed: every field goes
// through the field-type registry with the resolver's provenance, every edit is a server action
// that builds a change set for `apply()`, and the History tab reads the append-only events.
//
// Data (U4): the sheet is a client component that asks a server action for the item's data when
// it opens, and gets the refreshed data back from every save, so what it shows is always what the
// resolver says after the save, not what the form held. It needs no props beyond the item:
//
//   <ItemSheet itemId={id} />                          open until the page goes away
//   <ItemSheet itemId={id} open onOpenChange={...} />  controlled
//
// The venue comes from the page's route (`/venues/[venueId]`), or from the `venueId` prop where
// there is no such route (the development harness).
import type { Locale, LocalizedText } from '@restro/core'
import { AlertTriangleIcon } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type EnvironmentTag, FieldEnvironmentProvider, type TagDraft } from '@/fields/environment'
import { pickLocalized } from '@/fields/localized'
import { TillLabelProvider } from '@/fields/till-label'
import { isAdminLocale, toDataLocale } from '@/i18n/locales'
import {
  keepItemOverrideAction,
  loadItemSheetAction,
  removeItemImageAction,
  revertItemFieldAction,
  saveItemFieldAction,
  saveItemTranslationAction,
  setItemImageAction,
  setItemSoldOutAction,
} from '@/server/item-sheet/actions'
import type { ItemSheetData, SheetResult } from '@/server/item-sheet/types'

import { ItemSheetDetailsTab } from './item-sheet-details-tab'
import { ItemSheetHistoryTab } from './item-sheet-history-tab'
import { ItemSheetMediaTab } from './item-sheet-media-tab'
import { ItemSheetTranslationsTab } from './item-sheet-translations-tab'

export interface ItemSheetProps {
  /** The item's node id (`nd_…`). */
  itemId: string
  /** The venue (`vn_…`); defaults to the `venueId` of the page's route. */
  venueId?: string
  /** Open or closed; open when omitted. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** The venue's active tags, for the tags editor (the composer passes them). */
  tags?: readonly EnvironmentTag[]
  /** Creates a tag in the venue's list and resolves with it once saved; null if it was not. */
  onCreateTag?: (draft: TagDraft) => Promise<EnvironmentTag | null>
}

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: ItemSheetData }
  | { readonly status: 'missing' }
  | { readonly status: 'error' }

const TABS = ['details', 'translations', 'media', 'history'] as const
type TabId = (typeof TABS)[number]

function isTab(value: string): value is TabId {
  return (TABS as readonly string[]).includes(value)
}

/**
 * "Overrides to review" (V12, brief S6: the badge on the item's row, and this note): the till
 * changed a value since our override of it was made. The fields are named; Details offers "Keep
 * mine" or the till's value for each. Nothing when there is none.
 */
function ReviewNotice({ data }: { data: ItemSheetData }) {
  const t = useTranslations('itemSheet.review')
  const uiLanguage = useLocale()
  const dataLocale: Locale = toDataLocale(isAdminLocale(uiLanguage) ? uiLanguage : 'bg')
  const keys = [
    ...new Set(
      data.issues
        .filter((issue) => issue.code === 'stale_override')
        .map((issue) => issue.fieldKey ?? ''),
    ),
  ]
  if (keys.length === 0) return null
  const fields = keys.map((key) => {
    const definition = data.fields.find((field) => field.key === key)?.definition
    return definition ? (pickLocalized(definition.label, dataLocale) ?? definition.key) : key
  })
  return (
    <section
      aria-label={t('title')}
      data-testid="review-notice"
      className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
    >
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div className="grid gap-0.5">
        <p className="font-medium">{t('title')}</p>
        <p className="text-muted-foreground">
          {t('text', { source: data.tillLabel, fields: fields.join(', ') })}
        </p>
      </div>
    </section>
  )
}

export function ItemSheet({
  itemId,
  venueId: venueIdProp,
  open = true,
  onOpenChange,
  tags,
  onCreateTag,
}: ItemSheetProps) {
  const t = useTranslations('itemSheet')
  const params = useParams<{ venueId?: string }>()
  const venueId = venueIdProp ?? (typeof params.venueId === 'string' ? params.venueId : undefined)
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [tab, setTab] = useState<TabId>('details')
  const [busy, setBusy] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  // Every tab starts at its top, not where the previous one was scrolled to.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the tab is the trigger, not an input
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0
  }, [tab])

  // Fetch the item's data whenever the sheet opens for an item.
  useEffect(() => {
    if (!open) return
    if (venueId === undefined) {
      setLoaded({ status: 'error' })
      return
    }
    let cancelled = false
    setLoaded({ status: 'loading' })
    setTab('details')
    loadItemSheetAction(venueId, itemId)
      .then((data) => {
        if (!cancelled) setLoaded(data ? { status: 'ready', data } : { status: 'missing' })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [open, venueId, itemId])

  // The name of the item's till: `{source}` in "From {source}" and the like (brief CF-03).
  const source = loaded.status === 'ready' ? loaded.data.tillLabel : ''

  /** Runs a save; shows its refreshed data, or says why nothing changed. True when it saved. */
  const run = useCallback(
    async (task: Promise<SheetResult>, success?: string): Promise<boolean> => {
      setBusy(true)
      try {
        const result = await task
        if (result.ok) {
          setLoaded({ status: 'ready', data: result.data })
          if (success) toast.success(success)
          return true
        }
        toast.error(t(`errors.${result.error}`, { source }))
        return false
      } catch {
        toast.error(t('errors.failed'))
        return false
      } finally {
        setBusy(false)
      }
    },
    [t, source],
  )

  const data = loaded.status === 'ready' ? loaded.data : null
  const assetUrls = useMemo(
    () => (data?.image?.url ? { [data.image.assetId]: data.image.url } : {}),
    [data?.image?.assetId, data?.image?.url],
  )

  const saveField = (fieldKey: string, value: unknown | null) =>
    venueId
      ? run(saveItemFieldAction(venueId, itemId, fieldKey, value), t('saved'))
      : Promise.resolve(false)
  const revertField = (fieldKey: string) =>
    venueId
      ? run(revertItemFieldAction(venueId, itemId, fieldKey), t('reverted', { source }))
      : Promise.resolve(false)
  const keepField = (fieldKey: string) =>
    venueId
      ? run(keepItemOverrideAction(venueId, itemId, fieldKey), t('kept'))
      : Promise.resolve(false)
  const setSoldOut = (soldOut: boolean) =>
    venueId
      ? run(
          setItemSoldOutAction(venueId, itemId, soldOut),
          t(soldOut ? 'soldOutSaved' : 'backOnSale'),
        )
      : Promise.resolve(false)
  const saveTranslation = (fieldKey: string, locale: Locale, text: string | null) =>
    venueId
      ? run(saveItemTranslationAction(venueId, itemId, fieldKey, locale, text), t('saved'))
      : Promise.resolve(false)
  const attachImage = (assetId: string) =>
    venueId
      ? run(
          setItemImageAction(venueId, itemId, assetId, data?.image?.alt ?? {}, null),
          t('imageSaved'),
        )
      : Promise.resolve(false)
  const saveImageDetails = (alt: LocalizedText, focal: { x: number; y: number } | null) =>
    venueId && data?.image
      ? run(setItemImageAction(venueId, itemId, data.image.assetId, alt, focal), t('saved'))
      : Promise.resolve(false)
  const removeImage = () =>
    venueId
      ? run(removeItemImageAction(venueId, itemId), t('imageRemoved'))
      : Promise.resolve(false)

  const title = data ? data.title || t('untitled') : t('loadingTitle')

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:max-w-2xl"
        data-testid="item-sheet"
        aria-busy={loaded.status === 'loading' || busy}
      >
        <SheetHeader className="border-b pr-12">
          <SheetTitle data-testid="item-sheet-title">{title}</SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-2">
              {data ? (
                <>
                  <Badge variant={data.linkedToTill ? 'info' : 'secondary'}>
                    {data.linkedToTill ? t('linked', { source }) : t('createdHere')}
                  </Badge>
                  {data.linkState === 'missing' || data.linkState === 'deleted' ? (
                    <Badge variant="danger">{t(`linkState.${data.linkState}`, { source })}</Badge>
                  ) : null}
                  <span>{t('issueCount', { count: data.issues.length })}</span>
                </>
              ) : (
                t('description')
              )}
            </div>
          </SheetDescription>
        </SheetHeader>

        {loaded.status === 'loading' ? (
          <div className="grid gap-3 p-4" data-testid="item-sheet-loading">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : null}
        {loaded.status === 'missing' || loaded.status === 'error' ? (
          <p
            role="alert"
            className="p-4 text-sm text-muted-foreground"
            data-testid="item-sheet-problem"
          >
            {t(loaded.status === 'missing' ? 'missing' : 'loadError')}
          </p>
        ) : null}

        {data ? <ReviewNotice data={data} /> : null}

        {data ? (
          <TillLabelProvider label={data.tillLabel}>
            <FieldEnvironmentProvider
              enabledLocales={data.enabledLocales}
              currency={data.currency as 'EUR'}
              timezone={data.timezone}
              assetUrls={assetUrls}
              defaultLocale={data.defaultLocale}
              tags={tags}
              createTag={onCreateTag}
            >
              <Tabs
                value={tab}
                onValueChange={(value) => {
                  if (isTab(value)) setTab(value)
                }}
                className="min-h-0 flex-1 gap-0"
              >
                <div className="border-b px-4 py-2">
                  <TabsList className="w-full">
                    {TABS.map((id) => (
                      <TabsTrigger key={id} value={id}>
                        {t(`tabs.${id}`)}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
                <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto p-4">
                  {/* Details, Translations and Media stay mounted when hidden (Radix leaves a
                    force-mounted panel showing, so the wrapper hides it), so a half-written
                    translation survives a look at another tab. History loads when it is opened. */}
                  <TabsContent value="details" forceMount>
                    <div hidden={tab !== 'details'}>
                      <ItemSheetDetailsTab
                        data={data}
                        busy={busy}
                        onSave={saveField}
                        onRevert={revertField}
                        onKeep={keepField}
                        onOpenMedia={() => setTab('media')}
                        onSoldOut={setSoldOut}
                      />
                    </div>
                  </TabsContent>
                  <TabsContent value="translations" forceMount>
                    <div hidden={tab !== 'translations'}>
                      <ItemSheetTranslationsTab data={data} busy={busy} onSave={saveTranslation} />
                    </div>
                  </TabsContent>
                  <TabsContent value="media" forceMount>
                    <div hidden={tab !== 'media'}>
                      <ItemSheetMediaTab
                        key={`${data.revision}:${data.image?.assetId ?? ''}`}
                        data={data}
                        busy={busy}
                        onAttach={attachImage}
                        onSaveDetails={saveImageDetails}
                        onRemove={removeImage}
                      />
                    </div>
                  </TabsContent>
                  <TabsContent value="history">
                    {venueId ? (
                      <ItemSheetHistoryTab
                        venueId={venueId}
                        itemId={itemId}
                        revision={data.revision}
                      />
                    ) : null}
                  </TabsContent>
                </div>
              </Tabs>
            </FieldEnvironmentProvider>
          </TillLabelProvider>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
