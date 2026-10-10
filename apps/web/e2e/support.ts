// What the e2e tests share: the demo owner that `pnpm db:seed:dev` creates. The values come from
// the environment (.env.local) and default to the ones in .env.example, which are local-only.
export const ADMIN_EMAIL = process.env.DEV_ADMIN_EMAIL ?? 'owner@demo-club.test'
export const ADMIN_PASSWORD = process.env.DEV_ADMIN_PASSWORD ?? 'local-only-not-a-secret'
export const VENUE_NAME = 'Demo Club Sofia'
// The barsy-linked item that `scripts/seed-item-sheet.ts` puts in the demo venue (Bulgarian name).
export const ITEM_SHEET_ITEM = 'Негрони (e2e)'

// The Integration tab's test (scripts/seed-integration-e2e.ts): its own organisation, venue and two
// people with the demo password, one owner and one plain member.
export const INTEGRATION_OWNER_EMAIL = 'integration-owner@demo-club.test'
export const INTEGRATION_MEMBER_EMAIL = 'integration-member@demo-club.test'
export const INTEGRATION_VENUE_NAME = 'Integration Club Sofia'

// The Publish tab's test (scripts/seed-publish-e2e.ts): its own organisation and venue, an owner and
// a plain member with the demo password, and the real worker running beside the web server.
export const PUBLISH_OWNER_EMAIL = 'publish-owner@demo-club.test'
export const PUBLISH_MEMBER_EMAIL = 'publish-member@demo-club.test'
export const PUBLISH_SLUG = 'publish-club'

// The guest page's test (scripts/seed-guest-e2e.ts publishes these): the demo venue's menu at
// /m/demo-club in the brand colour below, a table code, and a second, tagged menu at /m/tag-fixture.
export const GUEST_SLUG = 'demo-club'
export const GUEST_BRAND = '#2563eb'
export const GUEST_TABLE_TOKEN = 'tb_e2eGuestTable000001'
export const GUEST_TABLE_LABEL = '12'
export const TAG_SLUG = 'tag-fixture'
