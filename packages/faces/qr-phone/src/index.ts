// @restro/qr-phone: the QR-to-phone face. It draws a shell view model (`@restro/shell`) as a
// scrolling phone page and nothing else: no data loading, no database, no snapshot. The host
// (apps/web, `/m/<venue>`) loads the published files, builds the view model and renders this.

export { FACE_CSS } from './css'
export { QrPhoneFace, type QrPhoneFaceProps } from './face'
export { QR_PHONE_MANIFEST } from './manifest'
export { bcp47, type Locale, languageLabel } from './model'
export { QrPhoneNotice, QrPhoneSkeleton } from './notices'
