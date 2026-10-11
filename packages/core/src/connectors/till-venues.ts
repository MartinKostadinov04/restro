// The table that links a till's venues to ours, under the till role's name (D67): core outside
// this folder speaks of the till, never of a vendor. Today the only till connector is barsy, whose
// venues live in `barsy_venues`; a later connector kit (CF-06) gives each connector kind its own.
//
// Server-only: it re-exports database schema. It is not part of `./index.ts`, which stays pure
// and safe in the browser.
export { barsyVenues as tillVenueLinks } from '@restro/db'
