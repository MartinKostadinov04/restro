// For tests only (not part of the app): the options the Editorial Market declared until D92 made
// its layouts the menu's settings (brief S6). The option machinery (the Design tab's look options,
// the Guest features card's template switches, `mergeOptions`) is generic; its tests give a
// template these options back to keep it honest.
import type { FaceManifest } from '@restro/shell'

export const OPTIONS_BEFORE_D92: FaceManifest['options'] = {
  layout: {
    type: 'enum',
    values: ['list', 'one', 'two'],
    default: 'two',
    group: 'look',
    label: { bg: 'Подредба на менюто', en: 'Menu layout' },
  },
  featureFirstSection: {
    type: 'boolean',
    default: true,
    group: 'look',
    label: { bg: 'Първата секция като лента със снимки', en: 'Photo strip for the first section' },
  },
  layoutSwitch: {
    type: 'boolean',
    default: true,
    group: 'feature',
    label: { bg: 'Гостите могат да сменят подредбата', en: 'Guests can change the layout' },
  },
}
