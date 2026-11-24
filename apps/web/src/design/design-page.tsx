'use client'

// The Design page (D129): the editing panel on the left, the live preview on the right (docked under
// the panel on a phone). The panel opens on a list of parts (D159, `part-rows.tsx`): in Simple the
// Style, Colours and logo, Fonts and Layout; in Advanced the first three, then General and the
// thirteen component pages of the contract file (`advanced-panel.tsx`). A row opens its part in
// place, with ‹ Back to the list; the address remembers the open part (`?part=`, `part-address.ts`)
// and the preview shows it. Simple and Advanced are one draft, so switching keeps every edit and the
// open part where the other level has it. A tap on a marked part of the preview opens its page (click
// to edit), or, in Simple, says the part is styled in Advanced. Every change is a change
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
import { DESIGN_PAGES, designLayoutOf, SNAPSHOT_MENU_LAYOUTS } from '@restro/core'
import { ArrowLeftIcon, Undo2Icon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
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
import { resolveAdminLocale } from '@/i18n/locales'
import { cn } from '@/lib/utils'
import { WRAPS } from '@/lib/wrapping'
import type { PreviewScheme } from '@/publish/draft-face'
import { saveDesignAction } from '@/server/design/actions'
import type { DesignView } from '@/server/design/service'
import type { MyStyles as MyStylesData } from '@/server/design/styles'

import {
  type PanelMode,
  pageOfMarker,
  pageOfTap,
  previewStageOf,
  withOption,
} from './advanced-model'
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
import { LogoField, useLogoUpload } from './logo-field'
import { isValidLook, type ValidLook } from './look-state'
import { MyStyles } from './my-styles'
import {
  leavePart,
  PART_PARAM,
  partInAddress,
  pushPart,
  replacePart,
  stepUnderPart,
} from './part-address'
import {
  isOwnPart,
  type OwnPartId,
  openingOf,
  type PartId,
  pageOfPart,
  partAcross,
  partListOf,
} from './part-list'
import { fontStackOf, Pane, type PaneEnter, PartHeader, PartRows } from './part-rows'
import { usePreviewDraft } from './preview-draft'
import { Segmented } from './segmented'
import { StyleTiles } from './style-tiles'

/** One group of controls inside an open part (the logo under the colours). */
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
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

/** Where the panel is: the level, the open part (null: the list), and how that view arrived. */
interface PanelView {
  readonly mode: PanelMode
  readonly part: PartId | null
  readonly enter: PaneEnter
}

/** How much shorter the visible screen gets when a phone's keyboard is up, at the least. */
const KEYBOARD_PX = 120

/** A box the phone's keyboard comes up for (not a radio, a switch or a colour picker). */
function isTextBox(target: EventTarget): boolean {
  if (target instanceof HTMLTextAreaElement) return true
  if (!(target instanceof HTMLInputElement)) return false
  return !['radio', 'checkbox', 'color', 'file', 'button', 'submit', 'range'].includes(target.type)
}

/** A choice option of the contract's General page. */
function generalOption(id: string): Extract<DesignOption, { kind: 'choice' }> {
  const option = DESIGN_PAGES[0].options.find((entry) => entry.id === id)
  if (option === undefined || option.kind !== 'choice') {
    throw new Error(`the design contract has no choice option ${id}`)
  }
  return option as Extract<DesignOption, { kind: 'choice' }>
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
  const [saving, startSaving] = useTransition()
  const [leaving, setLeaving] = useState(false)
  // Simple or Advanced, and the part open in the panel (the address's `?part=`, D159). Both levels
  // look at the one draft.
  const requested = useSearchParams().get(PART_PARAM)
  const [panel, setPanel] = useState<PanelView>(() => ({
    ...openingOf(requested, 'simple'),
    enter: null,
  }))
  const { mode, part } = panel
  const current = useRef(panel)
  current.current = panel
  // Where the focus goes once the next view is drawn: the open part's title, or the row it left.
  const focusNext = useRef<{ readonly title: true } | { readonly row: string } | null>(null)
  // The page's own step back is on its way, and the part to name once it lands (null: the list).
  const stepping = useRef<{ readonly next: PartId | null } | null>(null)
  const panelBox = useRef<HTMLDivElement>(null)
  const partTitleId = useId()
  // Each view is drawn anew (the pane is keyed by it) and starts at its top; the focus goes to the
  // open part's title, or back to the row of the part it left, as that element is drawn.
  const takeFocus = useCallback((node: HTMLElement, wanted: (target: object) => boolean) => {
    const target = focusNext.current
    if (target === null || !wanted(target)) return
    focusNext.current = null
    panelBox.current?.scrollTo?.({ top: 0 })
    node.focus()
    node.scrollIntoView?.({ block: 'nearest' })
  }, [])
  const titleRef = useCallback(
    (node: HTMLHeadingElement | null) => {
      if (node !== null) takeFocus(node, (target) => 'title' in target)
    },
    [takeFocus],
  )
  const rowRef = useCallback(
    (id: string) => (node: HTMLButtonElement | null) => {
      if (node !== null) {
        takeFocus(node, (target) => 'row' in target && target.row === id)
      }
    },
    [takeFocus],
  )
  // In Simple, the page of a tapped part that only Advanced styles.
  const [styledIn, setStyledIn] = useState<DesignPageId | null>(null)
  // On a phone the preview sits at the foot of the screen; it steps aside while the keyboard is up.
  const [typing, setTyping] = useState(false)
  useEffect(() => {
    // A text box has the focus, and the keyboard is up: the visible part of the screen is shorter
    // than the tallest it has been at this width. A keyboard closed with the box still focused (the
    // phone's back button) brings the preview back. With no visual viewport, the focus alone counts.
    const viewport = window.visualViewport
    let focused = false
    let wide = viewport?.width ?? 0
    let tall = viewport?.height ?? 0
    const keyboardUp = () => {
      if (!viewport) return true
      if (viewport.width !== wide) {
        wide = viewport.width
        tall = viewport.height
      }
      tall = Math.max(tall, viewport.height)
      return tall - viewport.height > KEYBOARD_PX
    }
    const update = () => setTyping(focused && keyboardUp())
    const onIn = (event: FocusEvent) => {
      focused = event.target !== null && isTextBox(event.target)
      update()
    }
    const onOut = (event: FocusEvent) => {
      focused = event.relatedTarget !== null && isTextBox(event.relatedTarget)
      update()
    }
    document.addEventListener('focusin', onIn)
    document.addEventListener('focusout', onOut)
    viewport?.addEventListener('resize', update)
    return () => {
      document.removeEventListener('focusin', onIn)
      document.removeEventListener('focusout', onOut)
      viewport?.removeEventListener('resize', update)
    }
  }, [])

  // A logo going up stays with the page whichever control is on the screen; its local links live
  // while the draft, Undo's steps or the saved design can still show them.
  const held = useMemo(
    () => [baseline, history.draft, ...history.past].map((step) => step.logo?.url ?? null),
    [baseline, history],
  )
  const logoUpload = useLogoUpload(held, (logo) => change((current) => withLogo(current, logo)))
  const uploading = logoUpload.progress !== null

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
  const edited = useMemo(() => keyOfDraft(draft) !== keyOfDraft(baseline), [draft, baseline])
  // A stored design that is not a valid record opens as what could be read of it, and counts as
  // changed from the start: the publisher refuses the venue until a save replaces the row, and its
  // refusal says to save the design again, so Done must not be greyed out (DA-33). It stops
  // counting once a save has gone through.
  const [repair, setRepair] = useState(initial.repair === true)
  const dirty = edited || repair
  const readable = view.issues.length === 0
  const canSave = canEdit && dirty && design !== null && readable && !uploading && !saving

  const backHref = studioPath(venueId, menuId)

  // Leaving the page with edits that are not saved: the browser's own warning.
  useEffect(() => {
    if (!canEdit || !edited) return undefined
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [canEdit, edited])

  /**
   * A new draft. A function is given the draft as it is when the change lands, for a change that
   * finishes later than it started (a logo upload): the edits made meanwhile stay.
   */
  function change(next: DesignDraft | ((current: DesignDraft) => DesignDraft), key?: string) {
    const now = Date.now()
    setHistory((current) =>
      changed(current, typeof next === 'function' ? next(current.draft) : next, { key, now }),
    )
  }

  // --- The preview ---
  // It shows the open part's part: its sheet or dish open, scrolled to it; the menu's top otherwise.
  const preview = useMemo(() => previewStageOf(part), [part])
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
    setRepair(stored.repair === true)
    followScreen(next.values)
  }

  function onDone() {
    if (!canSave || design === null) return
    // The draft as Done saves it. The panel stays open while it goes: an edit made meanwhile is not
    // in this save, and stays as an unsaved change.
    const saved = draft
    startSaving(async () => {
      const result = await saveDesignAction({ venueId, expectedRevision: revision, design }).catch(
        () => ({ ok: false, error: 'failed' }) as const,
      )
      if (result.ok) {
        setRevision(result.revision)
        setBaseline(saved)
        setHistory((current) => (current.draft === saved ? historyOf(saved) : current))
        setRepair(false)
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

  // --- The list of parts, Simple and Advanced ---

  // A part a reload or a link opened gets the list under it, so the browser's Back returns to the
  // list; an address naming no part we have is cleared.
  useEffect(() => {
    const opened = current.current.part
    if (opened !== null) stepUnderPart(opened)
    else if (partInAddress() !== null) replacePart(null)
  }, [])

  // The browser's Back and Forward move between the list and a part (the address is the truth).
  // The page's own step back (‹ Back) lands here too: the panel is on the list already, and a part
  // opened before it landed gets its step now.
  useEffect(() => {
    const onPop = () => {
      const own = stepping.current
      if (own !== null) {
        stepping.current = null
        if (own.next !== null) pushPart(own.next)
        return
      }
      const was = current.current
      const next = openingOf(partInAddress(), was.mode)
      if (next.part === was.part && next.mode === was.mode) return
      focusNext.current =
        next.part !== null ? { title: true } : was.part === null ? null : { row: was.part }
      setPanel({ ...next, enter: next.part === null ? 'back' : 'forward' })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  /**
   * The address follows the panel: a part opened from the list is a step of its own, another part
   * names itself on the same step, and the list steps back. While the page's own step back has not
   * landed, the part is kept for it (`onPop` above): a step pushed now would be the one undone.
   */
  function addressTo(next: PartId | null) {
    if (stepping.current !== null) stepping.current = { next }
    else if (part === null) {
      if (next !== null) pushPart(next)
    } else if (next === null) {
      if (leavePart()) stepping.current = { next: null }
    } else if (next !== part) replacePart(next)
  }

  /** Opens a part in place, with the focus on its title. */
  function openPart(id: PartId, level: PanelMode = mode) {
    addressTo(id)
    focusNext.current = { title: true }
    setPanel({ mode: level, part: id, enter: 'forward' })
  }

  /** ‹ Back: the list, with the focus on the row the part was opened from. */
  function backToList() {
    if (part === null) return
    addressTo(null)
    focusNext.current = { row: part }
    setPanel({ mode, part: null, enter: 'back' })
  }

  /** The level switch keeps the open part where the other level has it; else the list. */
  function switchLevel(next: PanelMode) {
    setStyledIn(null)
    if (next === mode) return
    const kept = partAcross(part, next)
    addressTo(kept)
    // The focus stays on the switch.
    focusNext.current = null
    setPanel({ mode: next, part: kept, enter: null })
  }

  // Click to edit: a tap on a marked part of the preview opens the page that owns it, unless the
  // open page is about that part, or what the tap opens (a dish tapped open on the Dish page). In
  // Simple the part is styled in Advanced only, and the panel says so.
  function onPart(marker: string, opens: string | null = null) {
    if (mode === 'simple') {
      const owner = pageOfMarker(marker)
      if (owner !== null) setStyledIn(owner)
      return
    }
    // A part of the panel's own (or the list) is no page: any tap opens its page.
    const open = (part !== null && !isOwnPart(part) ? part : '') as DesignPageId
    const owner = pageOfTap(marker, opens, open)
    if (owner !== null) openPart(owner)
  }

  function showAdvanced() {
    const owner = styledIn
    setStyledIn(null)
    if (owner === null) switchLevel('advanced')
    else openPart(owner, 'advanced')
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
      screen={draft.values.general.screen}
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
      upload={logoUpload}
      onRemove={() => change((current) => withLogo(current, null))}
    />
  )

  // The open part: its title beside ‹ Back, and what it holds.
  const openPage = part === null ? null : pageOfPart(part)
  const partTitle =
    part === null ? '' : openPage === null ? t(`parts.${part as OwnPartId}`) : openPage[locale]
  let partBody: ReactNode = null
  if (part === 'style') {
    partBody = styleControl
  } else if (part === 'colours') {
    partBody = (
      <>
        {coloursControl}
        <PanelSection title={t('logo.title')} testId="design-logo-section">
          {logoControl}
        </PanelSection>
      </>
    )
  } else if (part === 'fonts') {
    partBody = (
      <div className="grid gap-4" data-testid="design-fonts-section">
        {bodyFontControl}
        {headingFontControl}
      </div>
    )
  } else if (part === 'layout') {
    partBody = (
      <LayoutField
        values={draft.values}
        canEdit={canEdit}
        onChange={(layout) => change(withLayout(draft, layout))}
      />
    )
  } else if (openPage !== null) {
    partBody = (
      <AdvancedPanel
        venueId={venueId}
        locale={locale}
        page={openPage}
        values={draft.values}
        theme={shown.theme}
        draft={previewDraft}
        scheme={scheme}
        canEdit={canEdit}
        onPick={pick}
      />
    )
  }

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
          // On a phone the preview and the bar are docked under the panel: a control moved into view
          // stops above them, never behind them.
          ref={panelBox}
          className="relative grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6 p-4 max-md:[&_*]:scroll-mb-[calc(40svh+5rem)] md:overflow-y-auto md:border-r"
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
            onChange={switchLevel}
          />

          {mode === 'simple' && styledIn !== null ? (
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
          ) : null}

          <Pane key={`${mode}:${part ?? ''}`} enter={panel.enter}>
            {part === null ? (
              <PartRows
                list={partListOf(mode)}
                draft={draft}
                styles={myStyles}
                locale={locale}
                onOpen={(id) => openPart(id)}
                rowRef={rowRef}
              />
            ) : (
              <section
                className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6"
                aria-labelledby={partTitleId}
                data-testid="design-part-page"
                data-part={part}
              >
                <PartHeader
                  title={partTitle}
                  titleId={partTitleId}
                  titleRef={titleRef}
                  onBack={backToList}
                />
                {partBody}
              </section>
            )}
          </Pane>
        </div>

        {/* On a phone the preview is docked at the foot of the screen, above the bar, so a tap on a
            Style shows at once (D129); from 768 px both are cells of the page's grid. */}
        <div
          className="sticky bottom-0 z-10 grid bg-background md:contents"
          data-testid="design-dock"
        >
          <section
            className={cn(
              'h-[40svh] min-w-0 border-t p-2 md:col-start-2 md:row-span-2 md:row-start-1 md:h-auto md:min-h-0 md:border-t-0 md:p-4',
              typing && 'max-md:hidden',
            )}
            aria-label={t('preview.title')}
            data-testid="design-preview-section"
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
              stage={preview.stage}
              focus={preview.focus}
            />
          </section>

          {canEdit ? (
            <div
              className="grid gap-2 border-t bg-background p-3 md:col-start-1 md:row-start-2 md:border-r"
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
