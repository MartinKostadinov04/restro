// The integration layer's names for the first connector's link tables (brief CF-03, D82): a venue
// of ours serves one till venue (`tillVenueLinks`), and a till venue's places are mirrored into
// the platform's `tables` (`tillPlaces`, D95). Platform code reads them under these names, so no
// vendor word reaches it; the columns are the connector package's own.
export { barsyVenues as tillVenueLinks, places as tillPlaces } from '@restro/db'
