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
