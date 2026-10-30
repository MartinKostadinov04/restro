'use client'

// The Design tab (briefs SH-05a and S7; D70, D92, D93, D129): the venue's look, edited beside a
// sticky phone preview of what is not saved yet. It is the composer's Design subtab. In Martin's
// order:
//
//   - the template, collapsed to one line, which opens a phone pop-up of it;
//   - card 1, the logo and the header name of the open menu;
//   - card 2, the guest functions (the composer's card, restyled in place);
//   - card 3, font, corners, shadow and screen;
//   - card 4, colours, brand-first: the brand colour, the page and the panels, and the colours
//     worked out from them under "Advanced".
//
// What is saved when, and by what:
//   - the header name saves with its own button (`renameMenuAction`);
//   - the guest functions save with their own button (the composer's actions);
//   - the look (colours, font, corners, shadow, screen, logo) saves together with "Save look":
//     always the WHOLE look, never part of one, and never while a pair of colours does not read.
//     It names the revision the tab loaded: another person's save in between refuses it, and the
//     tab reloads the stored design and says so.
//
// A saved change reaches guests with the next publish, like any hand edit.
import type { GuestFeatures, VenueTheme } from '@restro/core'
import { useLocale, useTranslations } from 'next-intl'
import { type ReactNode, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { GuestFeaturesCard } from '@/composer/guest-features-panel'
import { DEFAULT_FACE_ID, type FaceEntry } from '@/faces/registry'
import { resolveAdminLocale } from '@/i18n/locales'
import type { PreviewScheme } from '@/publish/draft-face'
import { saveLookAction } from '@/server/design/actions'
import type { DesignView, LookResult } from '@/server/design/service'

import { ColourPanel } from './colour-panel'
import { DesignPreview } from './design-preview'
import { HeaderNameField, type HeaderNameMenu } from './header-name-field'
import { LogoField, type LogoState } from './logo-field'
import {
  isBrandOnlyLook,
  isValidLook,
  type LookState,
  lookStateOf,
  lookViewOf,
  type ValidLook,
} from './look-state'
import { usePreviewDraft } from './preview-draft'
import { useIssueText } from './role-panel'
import { StylePanel } from './style-panel'
import { TemplateChooser } from './template-gallery'
import { TemplatePreviewDialog } from './template-preview-dialog'

/** One card of the tab. */
function Section({
  title,
  description,
  children,
  testId,
}: {
  title: string
  description: string
  children: ReactNode
  testId: string
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle>
          <h3 className="text-base font-semibold">{title}</h3>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">{children}</CardContent>
    </Card>
  )
}

/** The look as one comparable string: what "has anything changed" is measured with. */
const keyOf = (theme: VenueTheme | null) => JSON.stringify(theme)

export function DesignPanel({
  venueId,
  initial,
  menu,
  venueName,
  features,
}: {
  venueId: string
  initial: DesignView
  /** The open menu (`?menu=`, else the live one), or null when the venue has none. */
  menu: HeaderNameMenu | null
  /** What a menu without a header name is called. */
  venueName: string
  /** The guest services the venue switched on. */
  features: GuestFeatures
}) {
  const t = useTranslations('design')
  const locale = resolveAdminLocale(useLocale())
  const issueText = useIssueText()
  const { canEdit } = initial

  // --- The look ---
  const [state, setState] = useState<LookState>(() => lookStateOf(initial.theme))
  const [logo, setLogo] = useState<LogoState | null>(initial.logo)
  const [uploading, setUploading] = useState(false)
  // A look saved the old way (one brand colour) is shown as its three colours, which guests do not
  // have yet: it counts as unsaved until it is saved from here.
  const [savedKey, setSavedKey] = useState<string | null>(() =>
    isBrandOnlyLook(initial.theme) ? null : keyOf(lookViewOf(lookStateOf(initial.theme)).theme),
  )
  const [savedHere, setSavedHere] = useState(false)
  const [lookError, setLookError] = useState<Extract<LookResult, { ok: false }> | null>(null)
  const [saving, startSaving] = useTransition()
  // The revision this form started from; a save names it (D129).
  const [revision, setRevision] = useState(initial.revision)

  const view = useMemo(() => lookViewOf(state), [state])
  // While a box holds half a colour the look has no value; the roles and the preview keep the
  // last whole one, and the box is marked.
  const [lastGood, setLastGood] = useState<ValidLook>(() => {
    const first = lookViewOf(lookStateOf(initial.theme))
    if (!isValidLook(first)) throw new Error('a saved look always works out to a whole look')
    return first
  })
  if (isValidLook(view) && view !== lastGood) setLastGood(view)
  const shown = isValidLook(view) ? view : lastGood
  const dirty = view.theme === null || keyOf(view.theme) !== savedKey
  const readable = view.issues.length === 0
  const canSave = canEdit && dirty && view.theme !== null && readable && !uploading && !saving

  function change(next: LookState) {
    setSavedHere(false)
    setLookError(null)
    setState(next)
  }

  function chooseLogo(next: LogoState | null) {
    setLogo(next)
    change({ ...state, logoAssetId: next?.assetId ?? null })
  }

  function reload(stored: DesignView) {
    const next = lookStateOf(stored.theme)
    setState(next)
    setLogo(stored.logo)
    setRevision(stored.revision)
    setSavedKey(isBrandOnlyLook(stored.theme) ? null : keyOf(lookViewOf(next).theme))
    setSavedHere(false)
  }

  function onSave() {
    const theme = view.theme
    if (!canSave || theme === null) return
    setLookError(null)
    startSaving(async () => {
      const result = await saveLookAction({ venueId, expectedRevision: revision, theme })
      if (result.ok) {
        setRevision(result.revision)
        setSavedKey(keyOf(theme))
        setSavedHere(true)
        toast.success(t('saved'))
      } else {
        // Someone saved in between: the form takes the stored design, and says so.
        if (result.error === 'stale') reload(result.view)
        setLookError(result)
      }
    })
  }

  // --- The preview ---
  const { draft, refreshing, refresh } = usePreviewDraft(venueId, menu?.id ?? null)
  const [previewScheme, setPreviewScheme] = useState<PreviewScheme>(
    initial.theme.scheme === 'dark' ? 'dark' : 'light',
  )
  // The template whose pop-up is open.
  const [previewing, setPreviewing] = useState<FaceEntry | null>(null)

  const lookErrorText = lookError === null ? null : t(`errors.${lookError.error}`)

  return (
    <div
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_25rem]"
      data-testid="design-panel"
    >
      <div className="grid min-w-0 content-start gap-6">
        {canEdit ? null : (
          <p className="text-sm text-muted-foreground" data-testid="design-read-only">
            {t('readOnly')}
          </p>
        )}

        <TemplateChooser current={DEFAULT_FACE_ID} canEdit={canEdit} onPreview={setPreviewing} />

        <Section
          title={t('logoName.title')}
          description={t('logoName.description')}
          testId="design-logo-section"
        >
          <LogoField
            logo={logo}
            savedAssetId={initial.logo?.assetId ?? null}
            canEdit={canEdit}
            onChange={chooseLogo}
            onBusy={setUploading}
          />
          <HeaderNameField
            // Another menu is another name.
            key={menu?.id ?? 'none'}
            venueId={venueId}
            menu={menu}
            venueName={venueName}
            canEdit={canEdit}
            onSaved={refresh}
          />
        </Section>

        <GuestFeaturesCard venueId={venueId} features={features} canEdit={canEdit} />

        <Section
          title={t('style.title')}
          description={t('style.description')}
          testId="design-style-section"
        >
          <StylePanel
            font={state.font}
            radius={state.radius}
            shadow={state.shadow}
            scheme={state.scheme}
            canEdit={canEdit}
            onFont={(font) => change({ ...state, font })}
            onRadius={(radius) => change({ ...state, radius })}
            onShadow={(shadow) => change({ ...state, shadow })}
            onScheme={(scheme) => {
              change({ ...state, scheme })
              if (scheme !== 'auto') setPreviewScheme(scheme)
            }}
          />
        </Section>

        <Section
          title={t('colours.title')}
          description={t('colours.description')}
          testId="design-colours-section"
        >
          <ColourPanel
            state={state}
            view={view}
            roles={shown.roles}
            derived={shown.derived}
            issues={shown.issues}
            canEdit={canEdit}
            onChange={change}
          />
        </Section>

        {canEdit ? (
          <div
            className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur"
            data-testid="design-save-bar"
          >
            <div className="min-w-0 text-sm" aria-live="polite">
              {lookErrorText !== null && lookError !== null ? (
                <div
                  role="alert"
                  className="grid gap-1 text-destructive"
                  data-testid="design-error"
                >
                  <p>{lookErrorText}</p>
                  {lookError.error === 'unreadable' ? (
                    <ul className="list-disc pl-5 text-xs">
                      {lookError.issues.map((issue) => (
                        <li key={`${issue.mode}-${issue.fg}-${issue.bg}`}>{issueText(issue)}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : view.theme === null ? (
                <p className="text-destructive" data-testid="design-status">
                  {t('status.invalid')}
                </p>
              ) : !readable ? (
                <p className="text-destructive" data-testid="design-status">
                  {t('status.unreadable')}
                </p>
              ) : savedHere && !dirty ? (
                <p data-testid="design-status">{t('saved')}</p>
              ) : dirty ? (
                <p className="text-muted-foreground" data-testid="design-status">
                  {t('status.unsaved')}
                </p>
              ) : (
                <p className="text-muted-foreground" data-testid="design-status">
                  {t('status.clean')}
                </p>
              )}
            </div>
            <Button type="button" disabled={!canSave} onClick={onSave}>
              {saving ? t('saving') : t('save')}
            </Button>
          </div>
        ) : null}
      </div>

      {/* Beside the form on wide screens, and it stays in view while the form scrolls; below the
          form at phone width. If the window is shorter than the preview, it scrolls by itself. */}
      <aside
        className="min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:self-start lg:overflow-y-auto"
        aria-label={t('preview.title')}
        data-testid="design-preview-aside"
      >
        <DesignPreview
          draft={draft}
          refreshing={refreshing}
          onRefresh={refresh}
          menuName={menu === null ? null : (menu.name ?? venueName)}
          theme={shown.theme}
          scheme={previewScheme}
          onScheme={setPreviewScheme}
        />
      </aside>

      <TemplatePreviewDialog
        entry={previewing}
        name={previewing?.name[locale] ?? ''}
        draft={draft}
        onRetry={refresh}
        theme={shown.theme}
        scheme={previewScheme}
        onClose={() => setPreviewing(null)}
      />
    </div>
  )
}
