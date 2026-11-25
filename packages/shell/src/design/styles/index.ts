import type { PremadeStyleId } from '@restro/core'
import type { StyleFile } from '../style'
import { basicStyle } from './basic'
import { classicStyle } from './classic'
import { clubStyle } from './club'
import { editorialStyle } from './editorial'
import { softStyle } from './soft'

// Restro's five premade Styles, by id and in the contract's order (D128). Everything that needs the
// list reads it from here: the Design page's tiles, the design draft, the never-list harness's
// sweeps and the renderer's stored renderings. An organisation's own Styles are records, not files.

export const PREMADE_STYLES: Partial<Record<PremadeStyleId, StyleFile>> = {
  basic: basicStyle,
  editorial: editorialStyle,
  soft: softStyle,
  classic: classicStyle,
  club: clubStyle,
}
