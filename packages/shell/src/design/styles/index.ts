import type { PremadeStyleId } from '../contract'
import type { StyleFile } from '../style'
import { basicStyle } from './basic'
import { editorialStyle } from './editorial'

// Restro's premade Styles that exist so far, by id. Soft, Classic and Club are listed by the
// contract but get their files from their own tickets (Club is T87).

export const PREMADE_STYLES: Partial<Record<PremadeStyleId, StyleFile>> = {
  basic: basicStyle,
  editorial: editorialStyle,
}
