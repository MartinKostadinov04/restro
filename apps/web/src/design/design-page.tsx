'use client'

// The Design page (D129): the editing panel on the left, the live preview on the right (under the
// panel on a phone). In Simple the panel holds the Style tiles, the three colours with their harmony
// suggestions and Advanced roles, the body and heading fonts and the logo. In Advanced (D130) it holds
// General and the thirteen component pages, drawn from the contract file (`advanced-panel.tsx`); the
// two are one draft, so switching keeps every edit. A tap on a marked part of the preview opens the
// page that owns it (click to edit), or, in Simple, says the part is styled in Advanced. Every change is a change
// to a draft in this browser: the preview follows at once, and nothing is written until Done, which
// saves the whole design through `saveDesignAction` (D129, rule 1) from the revision the page loaded.
// Someone else's save in between refuses it: the page says so and takes the saved design. The design
// reaches guests on the next publish; nothing here writes a published file.
//
// A POS venue and a hand-made venue both get this page: the design is Restro's own.
import type {
  DesignOption,
  DesignPageId,
  DesignValues,
  PremadeStyleId,
  SnapshotLayout,
  StyleValues,
} from '@restro/core'
import { DESIGN_PAGES, designLayoutOf, SNAPSHOT_MENU_LAYOUTS, THEME_FONTS } from '@restro/core'
import { ArrowLeftIcon, Undo2Icon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { type ReactNode, useEffect, useId, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { studioPath } from '@/composer/design-path'
import { FONT_STACKS } from '@/fonts'
import { resolveAdminLocale } from '@/i18n/locales'
import { WRAPS } from '@/lib/wrapping'
import type { PreviewScheme } from '@/publish/draft-face'
import { saveDesignAction } from '@/server/design/actions'
import type { DesignView } from '@/server/design/service'
import type { MyStyles as MyStylesData } from '@/server/design/styles'

import { FIRST_PAGE, type PanelMode, pageOfMarker, withOption } from './advanced-model'
import { AdvancedPanel } from './advanced-panel'
import { ColourPanel } from './colour-panel'
import {
  changed,
  type DesignDraft,
  type DraftHistory,
  designOf,
  draftOf,
  historyOf,
  keyOfDraft,
  lookViewOfDraft,
  type PickedStyle,
  themeWithValues,
  undone,
  withBodyFont,
  withHeadingFont,
  withLayout,
  withLogo,
  withStyle,
  withStyleValues,
} from './design-draft'
import { DesignPreview } from './design-preview'
import { LogoField } from './logo-field'
import { isValidLook, type ValidLook } from './look-state'
import { MyStyles } from './my-styles'
import { usePreviewDraft } from './preview-draft'
import { Segmented } from './segmented'
import { StyleTiles } from './style-tiles'

/** One part of the panel. */
function PanelSection({
  title,
  testId,
  children,
}: {
  title: string
  testId: string
  children: ReactNode
}) {
  return (
    <section className="grid gap-3" data-testid={testId}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  )
}

/** A choice option of the contract's General page. */
function generalOption(id: string): Extract<DesignOption, { kind: 'choice' }> {
  const option = DESIGN_PAGES[0].options.find((entry) => entry.id === id)
  if (option === undefined || option.kind !== 'choice') {
    throw new Error(`the design contract has no choice option ${id}`)
  }
  return option as Extract<DesignOption, { kind: 'choice' }>
}

/** A font's name is drawn in the font; "the same as the body" has no font of its own. */
function fontStackOf(id: string): string | undefined {
  const font = THEME_FONTS.find((entry) => entry.id === id)
  return font === undefined ? undefined : FONT_STACKS[font.family]
}

function FontSelect({
  optionId,
  value,
  locale,
  canEdit,
  onChange,
}: {
  optionId: 'body_font' | 'heading_font'
  value: string
  locale: 'bg' | 'en'
  canEdit: boolean
  onChange: (value: string) => void
}) {
  const id = useId()
  const option = generalOption(optionId)
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{option[locale]}</Label>
      <Select value={value} onValueChange={onChange} disabled={!canEdit}>
        <SelectTrigger
          id={id}
          className="w-full"
          style={{ fontFamily: fontStackOf(value) }}
          data-testid={`design-${optionId.replace('_', '-')}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {option.values.map((entry) => (
            <SelectItem
              key={entry.id}
              value={entry.id}
              data-font={entry.id}
              style={{ fontFamily: fontStackOf(entry.id) }}
            >
              {entry[locale]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** The layout guests start in and whether they may switch it, for every menu of the venue. */
function LayoutField({
  values,
  canEdit,
  onChange,
}: {
  values: DesignValues
  canEdit: boolean
  onChange: (layout: SnapshotLayout) => void
}) {
  const t = useTranslations('design.layout')
  const id = useId()
  const layout = designLayoutOf(values)
  return (
    <div className="grid gap-3" data-testid="design-layout">
      <Segmented
        label={t('title')}
        value={layout.default}
        options={SNAPSHOT_MENU_LAYOUTS.map((word) => ({
          value: word,
          label: t(`layouts.${word}`),
        }))}
        disabled={!canEdit}
        onChange={(word) => onChange({ ...layout, default: word })}
      />
      <div className="flex items-center gap-2">
        <Switch
          id={id}
          checked={layout.guest_switch}
          disabled={!canEdit}
          onCheckedChange={(on) => onChange({ ...layout, guest_switch: on })}
          data-testid="design-layout-switch"
        />
        <Label htmlFor={id} className="font-normal">
          {t('guestSwitch')}
        </Label>
      </div>
    </div>
  )
}

export function DesignPage({
  venueId,
  venueName,
  initial,
  myStyles,
  menuId,
}: {
  venueId: string
  venueName: string
  initial: DesignView
  /** The organisation's saved Styles and the design in use at its other venues (D129). */
  myStyles: MyStylesData
  /** The menu the preview draws: the one the Studio had open, else the live one. */
  menuId: string | null
}) {
  const t = useTranslations('design')
  const router = useRouter()
  // One radio group for Restro's tiles and My styles', so exactly one tile is ever ticked.
  const styleGroup = useId()
  const locale = resolveAdminLocale(useLocale())
  const { canEdit } = initial

  const [history, setHistory] = useState<DraftHistory>(() => historyOf(draftOf(initial)))
  const { draft } = history
  // What Cancel goes back to: the design as last saved.
  const [baseline, setBaseline] = useState<DesignDraft>(draft)
  // The revision this page started from; a save names it (D129).
  const [revision, setRevision] = useState(initial.revision)
  const [uploading, setUploading] = useState(false)
  const [saving, startSaving] = useTransition()
  const [leaving, setLeaving] = useState(false)
  // Simple or Advanced, and the page open in Advanced. Both look at the one draft.
  const [mode, setMode] = useState<PanelMode>('simple')
  const [pageId, setPageId] = useState<DesignPageId>(FIRST_PAGE)
  // Counts the taps on the preview that opened a page: the page lands on its first option.
  const [reveal, setReveal] = useState(false)
  // In Simple, the page of a tapped part that only Advanced styles.
  const [styledIn, setStyledIn] = useState<DesignPageId | null>(null)

  const view = useMemo(() => lookViewOfDraft(draft), [draft])
  // While a box holds half a colour the look has no value; the roles and the preview keep the last
  // whole one, and the box is marked.
  const [lastGood, setLastGood] = useState<ValidLook>(() => {
    const first = lookViewOfDraft(draftOf(initial))
    if (!isValidLook(first)) throw new Error('a saved look always works out to a whole look')
    return first
  })
  if (isValidLook(view) && view !== lastGood) setLastGood(view)
  const shown = isValidLook(view) ? view : lastGood
  const previewTheme = useMemo(
    () => themeWithValues(shown.theme, draft.values),
    [shown.theme, draft.values],
  )

  const design = view.theme === null ? null : designOf(draft, view.theme)
  const dirty = useMemo(() => keyOfDraft(draft) !== keyOfDraft(baseline), [draft, baseline])
  const readable = view.issues.length === 0
  const canSave = canEdit && dirty && design !== null && readable && !uploading && !saving

  const backHref = studioPath(venueId, menuId)

  // Leaving the page with edits that are not saved: the browser's own warning.
  useEffect(() => {
    if (!canEdit || !dirty) return undefined
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [canEdit, dirty])

  function change(next: DesignDraft, key?: string) {
    setHistory((current) => changed(current, next, { key, now: Date.now() }))
  }

  // --- The preview ---
  const { draft: previewDraft, refresh } = usePreviewDraft(venueId, menuId)
  const [scheme, setScheme] = useState<PreviewScheme>(
    initial.design.values.general.screen === 'dark' ? 'dark' : 'light',
  )
  function followScreen(values: DesignValues) {
    const { screen } = values.general
    if (screen !== 'auto') setScheme(screen)
  }

  function take(stored: DesignView) {
    const next = draftOf(stored)
    setHistory(historyOf(next))
    setBaseline(next)
    setRevision(stored.revision)
    followScreen(next.values)
  }

  function onDone() {
    if (!canSave || design === null) return
    startSaving(async () => {
      const result = await saveDesignAction({ venueId, expectedRevision: revision, design }).catch(
        () => ({ ok: false, error: 'failed' }) as const,
      )
      if (result.ok) {
        setRevision(result.revision)
        setBaseline(draft)
        setHistory(historyOf(draft))
        toast.success(t('saved'))
        // A new logo has its picture for guests only now.
        refresh()
        return
      }
      if (result.error === 'stale') {
        take(result.view)
        refresh()
        // It stays until it is read: the person's edits are gone, and this says why.
        toast.error(t('errors.stale'), { duration: Number.POSITIVE_INFINITY, closeButton: true })
        return
      }
      toast.error(t(`errors.${result.error}`))
    })
  }

  function onCancel() {
    setHistory(historyOf(baseline))
    followScreen(baseline.values)
  }

  function onUndo() {
    const next = undone(history)
    setHistory(next)
    followScreen(next.draft.values)
  }

  // --- Simple and Advanced ---
  function openPage(id: DesignPageId) {
    setPageId(id)
    setReveal(true)
  }

  // Click to edit: a tap on a marked part of the preview opens the page that owns it. In Simple the
  // part is styled in Advanced only, and the panel says so.
  function onPart(marker: string) {
    const owner = pageOfMarker(marker)
    if (owner === null) return
    if (mode === 'simple') setStyledIn(owner)
    else openPage(owner)
  }

  function showAdvanced() {
    setMode('advanced')
    if (styledIn !== null) openPage(styledIn)
    setStyledIn(null)
  }

  function pick(page: string, option: string, value: string) {
    const next = withOption(draft, page, option, value)
    change(next)
    if (page === 'general' && option === 'screen') followScreen(next.values)
  }

  function pickStyleValues(
    from: { style: PremadeStyleId; values: StyleValues },
    picked: PickedStyle,
  ) {
    const next = withStyleValues(draft, from, picked)
    change(next)
    followScreen(next.values)
  }

  // Simple's controls, one of each: Simple lists them, Advanced's General hands them to its rows.
  // The Style control is two groups (D129): Restro's premade Styles, then the organisation's own.
  const styleControl = (
    <div className="grid gap-5">
      <div className="grid gap-3">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t('styles.restro')}
        </h3>
        <StyleTiles
          venueId={venueId}
          locale={locale}
          current={draft.style}
          chosen={draft.picked.kind === 'premade'}
          groupName={styleGroup}
          draft={previewDraft}
          theme={shown.theme}
          values={draft.values}
          canEdit={canEdit}
          onPick={(styleId) => {
            const next = withStyle(draft, styleId)
            change(next)
            followScreen(next.values)
          }}
        />
      </div>
      <MyStyles
        venueId={venueId}
        data={myStyles}
        groupName={styleGroup}
        picked={draft.picked}
        draft={previewDraft}
        theme={shown.theme}
        values={draft.values}
        style={draft.style}
        canEdit={canEdit}
        onPick={pickStyleValues}
        onChanged={() => router.refresh()}
      />
    </div>
  )
  const coloursControl = (
    <ColourPanel
      state={draft.look}
      view={view}
      roles={shown.roles}
      derived={shown.derived}
      issues={shown.issues}
      canEdit={canEdit}
      onChange={(look) => change({ ...draft, look }, 'colours')}
    />
  )
  const bodyFontControl = (
    <FontSelect
      optionId="body_font"
      value={draft.values.general.body_font}
      locale={locale}
      canEdit={canEdit}
      onChange={(font) => change(withBodyFont(draft, font))}
    />
  )
  const headingFontControl = (
    <FontSelect
      optionId="heading_font"
      value={draft.values.general.heading_font}
      locale={locale}
      canEdit={canEdit}
      onChange={(font) => change(withHeadingFont(draft, font))}
    />
  )
  const logoControl = (
    <LogoField
      logo={draft.logo}
      savedAssetId={baseline.logo?.assetId ?? null}
      canEdit={canEdit}
      onChange={(logo) => change(withLogo(draft, logo))}
      onBusy={setUploading}
    />
  )

  return (
    <div className="flex min-h-svh flex-col md:h-svh" data-testid="design-page">
      <header className="flex min-w-0 items-center gap-3 border-b px-2 py-2 sm:px-4">
        <Button asChild variant="ghost" size="sm">
          <Link
            href={backHref}
            data-testid="design-back"
            onClick={(event) => {
              if (canEdit && dirty) {
                event.preventDefault()
                setLeaving(true)
              }
            }}
          >
            <ArrowLeftIcon aria-hidden />
            {t('back')}
          </Link>
        </Button>
        <h1 className="min-w-0 truncate text-sm font-semibold">
          {t('title')} <span className="font-normal text-muted-foreground">· {venueName}</span>
        </h1>
      </header>

      <div className="grid flex-1 md:min-h-0 md:grid-cols-[22rem_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[26rem_minmax(0,1fr)]">
        <div
          className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-8 p-4 md:overflow-y-auto md:border-r"
          data-testid="design-panel"
        >
          {canEdit ? null : (
            <p className="text-sm text-muted-foreground" data-testid="design-read-only">
              {t('readOnly')}
            </p>
          )}
          <Segmented
            label={t('advanced.mode')}
            value={mode}
            options={[
              { value: 'simple', label: t('advanced.simple') },
              { value: 'advanced', label: t('advanced.advanced') },
            ]}
            onChange={(next) => {
              setMode(next)
              setStyledIn(null)
            }}
          />

          {mode === 'simple' ? (
            <>
              {styledIn === null ? null : (
                <div
                  role="status"
                  className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm"
                  data-testid="design-styled-in-advanced"
                >
                  <span className="min-w-0 flex-1 font-medium">{t('advanced.styledIn')}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={WRAPS}
                    onClick={showAdvanced}
                    data-testid="design-show-advanced"
                  >
                    {t('advanced.show')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('advanced.dismiss')}
                    onClick={() => setStyledIn(null)}
                  >
                    <XIcon aria-hidden />
                  </Button>
                </div>
              )}

              <PanelSection title={t('styles.title')} testId="design-style-section">
                {styleControl}
              </PanelSection>

              <PanelSection title={t('colours.title')} testId="design-colours-section">
                {coloursControl}
              </PanelSection>

              <PanelSection title={t('fonts.title')} testId="design-fonts-section">
                {bodyFontControl}
                {headingFontControl}
              </PanelSection>

              <PanelSection title={t('logo.title')} testId="design-logo-section">
                {logoControl}
              </PanelSection>

              <PanelSection title={t('layout.title')} testId="design-layout-section">
                <LayoutField
                  values={draft.values}
                  canEdit={canEdit}
                  onChange={(layout) => change(withLayout(draft, layout))}
                />
              </PanelSection>
            </>
          ) : (
            <AdvancedPanel
              venueId={venueId}
              locale={locale}
              open={pageId}
              reveal={reveal}
              onRevealed={() => setReveal(false)}
              onOpen={setPageId}
              values={draft.values}
              theme={shown.theme}
              draft={previewDraft}
              scheme={scheme}
              canEdit={canEdit}
              onPick={pick}
              custom={{
                style: styleControl,
                colours: (
                  <>
                    {coloursControl}
                    <PanelSection title={t('logo.title')} testId="design-logo-section">
                      {logoControl}
                    </PanelSection>
                  </>
                ),
                body_font: bodyFontControl,
                heading_font: headingFontControl,
              }}
            />
          )}
        </div>

        <section
          className="h-[85svh] min-w-0 border-t p-4 md:col-start-2 md:row-span-2 md:row-start-1 md:h-auto md:min-h-0 md:border-t-0"
          aria-label={t('preview.title')}
        >
          <DesignPreview
            venueId={venueId}
            draft={previewDraft}
            onRetry={refresh}
            theme={previewTheme}
            values={draft.values}
            scheme={scheme}
            onScheme={setScheme}
            onPart={onPart}
          />
        </section>

        {canEdit ? (
          <div
            className="sticky bottom-0 z-10 grid gap-2 border-t bg-background p-3 md:static md:col-start-1 md:row-start-2 md:border-r"
            data-testid="design-bar"
          >
            {view.theme === null || !readable ? (
              <p role="alert" className="text-sm text-destructive" data-testid="design-status">
                {view.theme === null ? t('status.invalid') : t('status.unreadable')}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={history.past.length === 0 || saving}
                onClick={onUndo}
                data-testid="design-undo"
              >
                <Undo2Icon aria-hidden />
                {t('undo')}
              </Button>
              {dirty ? (
                <span className="text-sm text-muted-foreground" data-testid="design-unsaved">
                  {t('unsaved')}
                </span>
              ) : null}
              <span className="ml-auto flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!dirty || saving}
                  onClick={onCancel}
                  data-testid="design-cancel"
                >
                  {t('cancel')}
                </Button>
                <Button
                  type="button"
                  disabled={!canSave}
                  onClick={onDone}
                  data-testid="design-done"
                >
                  {saving ? t('saving') : t('done')}
                </Button>
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <Dialog open={leaving} onOpenChange={setLeaving}>
        <DialogContent data-testid="design-leave">
          <DialogHeader>
            <DialogTitle>{t('leave.title')}</DialogTitle>
            <DialogDescription>{t('leave.description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLeaving(false)}>
              {t('leave.keep')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setLeaving(false)
                router.push(backHref)
              }}
            >
              {t('leave.leave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
