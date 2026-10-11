// @restro/editorial-market: the Editorial Market face, the first template of the gallery (D69). It
// draws a shell view model (`@restro/shell`) as a photo-led phone menu and nothing else: no data
// loading, no database, no snapshot. The host loads the published files, builds the view model
// and renders this. Browsing only; the service screens come with brief SH-06.

export { EDITORIAL_CSS } from './css'
export { EditorialMarketFace, type EditorialMarketFaceProps } from './face'
export { EDITORIAL_MARKET_MANIFEST } from './manifest'
