// The draft snapshot with the UNSAVED look applied in memory (brief SH-05a). The server builds the
// draft from what is saved; the tab lays the form's look over it, the way the publisher would
// write it (`snapshotThemeOf` in core/apply/publish.ts): the palette of the colours, the eight roles
// of both screens, the font family, corners, shadow and the light/dark policy. The logo stays as
// saved: a new logo has no photo variants until it is saved.
// Pure; the draft is not changed.
import {
  fontFamilyOf,
  type MenuSnapshot,
  paletteList,
  themePaletteOf,
  themeRolesOf,
  type VenueTheme,
} from '@restro/core'

export function previewSnapshot(draft: MenuSnapshot, theme: VenueTheme): MenuSnapshot {
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
    },
  }
}
