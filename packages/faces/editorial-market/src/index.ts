// @restro/editorial-market: the Editorial Market face, the first template of the gallery (D69). It
// draws a shell view model (`@restro/shell`) as a photo-led phone menu and nothing else: no data
// loading, no database, no snapshot. The host loads the published files, builds the view model
// and renders this. With the host's `services` bound it also draws the service screens (the bag,
// the table bill, calling a waiter, paying, the receipt, brief SH-06); without them it is the
// browsing page. The demo host for the admin's preview is the subpath `@restro/editorial-market/
// preview`, which a guest page never imports.

export { EDITORIAL_CSS } from './css'
export { EditorialMarketFace, type EditorialMarketFaceProps } from './face'
export { EDITORIAL_MARKET_MANIFEST } from './manifest'
export { SERVICES_CSS } from './services/services-css'
