// The draft snapshot with the UNSAVED design applied in memory (D129). The server builds the draft
// from what is saved; the page lays the draft design over it, the way the publisher would write it
// (`snapshotThemeOf` in core/apply/publish.ts, `designLayoutOf` in the builder): the palette of the
// colours, the eight roles of both screens, the font family, corners, shadow and the light/dark
// policy, every option's value, and the layout. A removed logo goes at once; a new logo has no photo
// variants until it is saved, so the saved one stays until then. Pure; the draft is not changed.
import {
  type DesignValues,
  designLayoutOf,
  fontFamilyOf,
  type MenuSnapshot,
  paletteList,
  themePaletteOf,
  themeRolesOf,
  type VenueTheme,
} from '@restro/core'

export function previewSnapshot(
  draft: MenuSnapshot,
  theme: VenueTheme,
  values: DesignValues,
): MenuSnapshot {
  return {
    ...draft,
    theme: {
      ...draft.theme,
      palette: paletteList(themePaletteOf(theme)),
      font: theme.font === undefined ? draft.theme.font : fontFamilyOf(theme.font),
      radius: theme.radius ?? draft.theme.radius,
      shadow: theme.shadow ?? draft.theme.shadow,
      roles: themeRolesOf(theme),
      scheme: theme.scheme ?? 'auto',
      logo: theme.logo_asset_id === null ? null : draft.theme.logo,
    },
    design: values,
    layout: designLayoutOf(values),
  }
}

/** How much of the menu a Style tile draws: a tile shows the top of it and no more. */
const SPECIMEN_SECTIONS = 2
const SPECIMEN_ITEMS = 4

/** The draft cut down to what a Style tile shows, so a tile draws no long menu it cannot show. */
export function specimenSnapshot(draft: MenuSnapshot): MenuSnapshot {
  const sections = Object.fromEntries(
    Object.entries(draft.sections).map(([id, section]) => [
      id,
      { ...section, items: section.items.slice(0, SPECIMEN_ITEMS) },
    ]),
  ) as MenuSnapshot['sections']
  return {
    ...draft,
    menu: { ...draft.menu, sections: draft.menu.sections.slice(0, SPECIMEN_SECTIONS) },
    sections,
  }
}
