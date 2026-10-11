'use client'

// The Design tab (briefs SH-05a, D69, D70): the venue's template and its look, edited beside a
// live phone preview of what is not saved yet. It replaces the Appearance card of Settings.
//
//   - Template: the gallery and the template's look options. They save when chosen.
//   - Look: the three colours (or one brand colour), the eight derived roles with their contrast,
//     font, corners, shadow, logo and the light/dark policy. They save together with "Save look":
//     always the WHOLE look, never part of one, and never while a pair of colours does not read.
//
// A saved change reaches guests with the next publish, like any hand edit.
import type { Presentation, VenueTheme } from '@restro/core'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { type FormEvent, type ReactNode, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type FaceEntry, faceEntry } from '@/faces/registry'
import type { PreviewScheme } from '@/publish/draft-face'
import { chooseTemplateAction, saveLookAction } from '@/server/design/actions'
import type { DesignView, LookResult, TemplateError } from '@/server/design/service'

import { ColourPanel } from './colour-panel'
import { DesignPreview } from './design-preview'
import { LogoField, type LogoState } from './logo-field'
import { LookOptions } from './look-options'
import { isValidLook, type LookState, lookStateOf, lookViewOf, type ValidLook } from './look-state'
import { RolePanel, useIssueText } from './role-panel'
import { StylePanel } from './style-panel'
import { TemplateGallery } from './template-gallery'
import { lookOptionsOf, mergeOptions, type OptionValues } from './template-options'

/** One block of the tab. */
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

export function DesignPanel({ venueId, initial }: { venueId: string; initial: DesignView }) {
  const t = useTranslations('design')
  const issueText = useIssueText()
  const { canEdit } = initial

  // --- The look ---
  const [state, setState] = useState<LookState>(() => lookStateOf(initial.theme))
  const [logo, setLogo] = useState<LogoState | null>(initial.logo)
  const [uploading, setUploading] = useState(false)
  const [savedKey, setSavedKey] = useState(() =>
    keyOf(lookViewOf(lookStateOf(initial.theme)).theme),
  )
  const [savedHere, setSavedHere] = useState(false)
  const [lookError, setLookError] = useState<Extract<LookResult, { ok: false }> | null>(null)
  const [saving, startSaving] = useTransition()

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

  function savedToast() {
    toast.success(t('saved'), {
      description: <Link href={`/venues/${venueId}?tab=publishing`}>{t('goPublishing')}</Link>,
    })
  }

  function onSave(event: FormEvent) {
    event.preventDefault()
    const theme = view.theme
    if (!canSave || theme === null) return
    setLookError(null)
    startSaving(async () => {
      const result = await saveLookAction({ venueId, theme })
      if (result.ok) {
        setSavedKey(keyOf(theme))
        setSavedHere(true)
        savedToast()
      } else {
        setLookError(result)
      }
    })
  }

  // --- The template ---
  const [face, setFace] = useState(initial.presentation.face)
  const [savedPresentation, setSavedPresentation] = useState<Presentation>(initial.presentation)
  const entry = faceEntry(face)
  const [lookOptions, setLookOptions] = useState<OptionValues>(() =>
    lookOptionsOf(faceEntry(initial.presentation.face).manifest, initial.presentation.options),
  )
  const [templateError, setTemplateError] = useState<TemplateError | null>(null)
  const [templatePending, startTemplate] = useTransition()

  function saveTemplate(nextFace: string, nextOptions: OptionValues) {
    const before = { face, options: lookOptions }
    setFace(nextFace)
    setLookOptions(nextOptions)
    setTemplateError(null)
    startTemplate(async () => {
      const result = await chooseTemplateAction({
        venueId,
        face: nextFace,
        lookOptions: nextOptions,
      })
      if (result.ok) {
        setSavedPresentation(result.presentation)
        savedToast()
      } else {
        setFace(before.face)
        setLookOptions(before.options)
        setTemplateError(result.error)
      }
    })
  }

  function chooseFace(next: FaceEntry) {
    saveTemplate(next.id, lookOptionsOf(next.manifest, lookOptions))
  }

  // --- The preview ---
  const [previewScheme, setPreviewScheme] = useState<PreviewScheme>(
    initial.theme?.scheme === 'dark' ? 'dark' : 'light',
  )
  const previewOptions = useMemo(
    () => mergeOptions(entry.manifest, savedPresentation, lookOptions),
    [entry, savedPresentation, lookOptions],
  )

  const lookErrorText = lookError === null ? null : t(`errors.${lookError.error}`)

  return (
    <div
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_25rem]"
      data-testid="design-panel"
    >
      <form onSubmit={onSave} className="grid min-w-0 content-start gap-6" noValidate>
        {canEdit ? null : (
          <p className="text-sm text-muted-foreground" data-testid="design-read-only">
            {t('readOnly')}
          </p>
        )}

        <Section
          title={t('templates.title')}
          description={t('templates.description')}
          testId="design-templates"
        >
          <TemplateGallery
            current={face}
            canEdit={canEdit}
            pending={templatePending}
            onChoose={chooseFace}
          />
          <LookOptions
            manifest={entry.manifest}
            values={lookOptions}
            disabled={!canEdit || templatePending}
            onChange={(next) => saveTemplate(face, next)}
          />
          {templateError ? (
            <p
              role="alert"
              className="text-sm text-destructive"
              data-testid="design-template-error"
            >
              {t(`errors.${templateError}`)}
            </p>
          ) : null}
        </Section>

        <Section
          title={t('colours.title')}
          description={t('colours.description')}
          testId="design-colours-section"
        >
          <ColourPanel state={state} view={view} canEdit={canEdit} onChange={change} />
          <RolePanel
            state={state}
            roles={shown.roles}
            derived={shown.derived}
            issues={shown.issues}
            invalid={view.invalid}
            canEdit={canEdit}
            onChange={change}
          />
        </Section>

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
          <LogoField
            logo={logo}
            savedAssetId={initial.logo?.assetId ?? null}
            canEdit={canEdit}
            onChange={chooseLogo}
            onBusy={setUploading}
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
                <p data-testid="design-status">
                  {t('saved')}{' '}
                  <Link
                    className="font-medium underline"
                    href={`/venues/${venueId}?tab=publishing`}
                  >
                    {t('goPublishing')}
                  </Link>
                </p>
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
            <Button type="submit" disabled={!canSave}>
              {saving ? t('saving') : t('save')}
            </Button>
          </div>
        ) : null}
      </form>

      <aside className="min-w-0 lg:sticky lg:top-4 lg:self-start" aria-label={t('preview.title')}>
        <DesignPreview
          venueId={venueId}
          theme={shown.theme}
          face={face}
          options={previewOptions}
          scheme={previewScheme}
          onScheme={setPreviewScheme}
        />
      </aside>
    </div>
  )
}
