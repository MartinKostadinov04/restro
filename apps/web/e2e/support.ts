// What the e2e tests share: the demo owner that `pnpm db:seed:dev` creates. The values come from
// the environment (.env.local) and default to the ones in .env.example, which are local-only.
export const ADMIN_EMAIL = process.env.DEV_ADMIN_EMAIL ?? 'owner@demo-club.test'
export const ADMIN_PASSWORD = process.env.DEV_ADMIN_PASSWORD ?? 'local-only-not-a-secret'
export const VENUE_NAME = 'Demo Club Sofia'
