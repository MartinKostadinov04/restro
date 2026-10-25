// Import rules for the monorepo (CLAUDE.md "Import boundaries"; docs/architecture/stack.md,
// "Repository and boundaries"). Run with `pnpm deps:check`; CI fails on any error.
//
// Paths are relative to the repository root. Workspace packages export TypeScript source, so
// an import of '@restro/db' resolves to a file under packages/db/. A package that is not
// declared as a dependency cannot be resolved, and then dependency-cruiser reports the
// import as written ('@restro/db'). Every rule therefore matches both forms.
//
// scripts/depcruise-rules.test.ts proves that each rule below fires on a forbidden import.
// Keep the two in step: a new rule needs a new case there.

/** Node built-ins that touch the outside world. Matches 'fs', 'node:fs' and 'fs/promises'. */
const NODE_IO_BUILTINS = [
  'child_process',
  'cluster',
  'dgram',
  'dns',
  'fs',
  'http',
  'http2',
  'https',
  'net',
  'tls',
].map((name) => `^(node:)?${name}(/|$)`)

/**
 * Every connector package (CLAUDE.md "Three layers"): barsy's and those under packages/connectors/
 * (the simulated POS today, D124). Rules that keep connectors out of a layer match all of them, so
 * no connector, old or new, falls out of a guard.
 */
const CONNECTOR_PACKAGES = [
  '^packages/barsy/',
  '^@restro/barsy(/|$)',
  '^packages/connectors/',
  '^@restro/sim-pos(/|$)',
]

/**
 * Every payment provider package (D127, #104): those under packages/payments/ (the simulated
 * provider `sim-pay` and Stripe's). Only the worker calls a provider.
 */
const PAYMENT_PACKAGES = ['^packages/payments/', '^@restro/(sim-pay|stripe)(/|$)']

/**
 * A payment provider's own libraries, server SDK and browser card form alike (D126, D127). The web
 * app reaches them only through its connector folders (apps/web/src/connectors/<kind>/).
 */
const PROVIDER_LIBRARIES = ['stripe', '@stripe'].flatMap((name) => [
  `^${name}(/|$)`,
  `(^|/)node_modules/${name}/`,
])

/** Database drivers and job queues: I/O that shell and faces must never reach. */
const IO_PACKAGES = ['pg', 'pg-boss', 'postgres'].flatMap((name) => [
  `^${name}(/|$)`,
  `(^|/)node_modules/${name}/`,
])

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // 1. Shell and faces are pure: they read a snapshot and render it (rule 4).
    {
      name: 'pure-layers-no-data-or-apps',
      severity: 'error',
      comment:
        'packages/shell and packages/faces/* must not import @restro/db, a connector, @restro/core/service, @restro/assets or anything under apps/.',
      from: { path: ['^packages/shell/', '^packages/faces/'] },
      to: {
        path: [
          '^packages/db/',
          '^@restro/db(/|$)',
          ...CONNECTOR_PACKAGES,
          '^packages/core/src/service/',
          '^@restro/core/service(/|$)',
          '^packages/assets/',
          '^@restro/assets(/|$)',
          '^apps/',
          '^@restro/(web|worker)(/|$)',
        ],
      },
    },
    {
      name: 'pure-layers-no-io-builtins',
      severity: 'error',
      comment:
        'packages/shell and packages/faces/* must not use Node built-ins that do I/O (fs, net, http, child_process, ...).',
      from: { path: ['^packages/shell/', '^packages/faces/'] },
      to: { path: NODE_IO_BUILTINS },
    },
    {
      name: 'pure-layers-no-database-drivers',
      severity: 'error',
      comment: 'packages/shell and packages/faces/* must not import pg, pg-boss or postgres.',
      from: { path: ['^packages/shell/', '^packages/faces/'] },
      to: { path: IO_PACKAGES },
    },

    // 1b. A face is a pure function from a view model to markup, and the registry loads it by
    //     name (SH-04): it may use React and the shell's types and helpers, nothing else. Not
    //     even core: a face that needs a core helper asks for it to be put into the shell, so
    //     the contract between host and face stays one package wide. `$1` is the face's own
    //     folder, which it may of course import. Test files and the `test-*` helpers beside them
    //     are exempt (they use vitest, Testing Library and the shell's `testing` fixtures); the
    //     shell's `testing` folder is otherwise off limits.
    {
      name: 'faces-only-react-and-shell',
      severity: 'error',
      comment:
        'A file under packages/faces/<face>/src/ (tests and test-* helpers excepted) may import only its own package, react, react-dom (and their internals, such as react/jsx-runtime and scheduler) and @restro/shell (not @restro/shell/testing). No @restro/core, no icon or UI library, no other face: the face stays a function of its view model, and its code stays small for the guest who downloads it.',
      from: {
        path: '^packages/faces/([^/]+)/src/',
        pathNot: ['\\.test\\.[jt]sx?$', '(^|/)test-[^/]+\\.[jt]sx?$'],
      },
      to: {
        pathNot: [
          '^packages/faces/$1/',
          '^(react|react-dom|scheduler)(/|$)',
          '(^|/)node_modules/(react|react-dom|scheduler)/',
          '^packages/shell/(?!testing/)',
          '^@restro/shell(/(?!testing(/|$))|$)',
        ],
      },
    },

    // 2. One write path per side (rule 1 as D122 §9 puts it): only apply() (the menu side) and
    //    applyService() (the service side) may use the write side of the db package, and the
    //    package has exactly two doors. Which tables each one writes is pinned by
    //    packages/core/src/write-targets.test.ts.
    {
      name: 'db-write-only-from-core-write-paths',
      severity: 'error',
      comment:
        'Only files under packages/core/src/apply/ and packages/core/src/service/ may import @restro/db/write.',
      from: { pathNot: ['^packages/core/src/(apply|service)/', '^packages/db/'] },
      to: { path: ['^packages/db/src/write(/|\\.|$)', '^@restro/db/write(/|$)'] },
    },
    {
      name: 'db-purge-only-from-worker-purge-job',
      severity: 'error',
      comment:
        'Only the worker purge job (apps/worker/src/jobs/purge*) may import @restro/db/purge: the purge role is the only one with DELETE on venue data (D83), and nothing else may erase anything.',
      from: { pathNot: ['^apps/worker/src/jobs/purge', '^packages/db/'] },
      to: { path: ['^packages/db/src/purge(/|\\.|$)', '^@restro/db/purge(/|$)'] },
    },
    {
      name: 'db-entry-points-only',
      severity: 'error',
      comment:
        'Outside packages/db, import the database package only through its three entry points, @restro/db, @restro/db/write and @restro/db/purge (packages/db/src/index.ts, packages/db/src/write/index.ts and packages/db/src/purge/index.ts). Anything else under packages/db/src, such as the connection pool, would let code run queries outside a tenant-scoped transaction.',
      from: { pathNot: '^packages/db/' },
      to: {
        path: [
          '^packages/db/src/(?!(index|write/index|purge/index)\\.ts$)',
          '^@restro/db/src(/|$)',
        ],
      },
    },
    {
      name: 'db-read-side-no-write',
      severity: 'error',
      comment:
        'Inside packages/db/src, only files under packages/db/src/write/ or packages/db/src/purge/ may import packages/db/src/write or packages/db/src/purge: the read side (the @restro/db entry, the pool, the schema) must never reach them, or the read-only entry point could end up exposing a write or purge transaction.',
      from: { path: '^packages/db/src/', pathNot: '^packages/db/src/(write|purge)/' },
      to: { path: '^packages/db/src/(write|purge)(/|\\.|$)' },
    },

    // The service write path is server code: the worker, the guest API's route handlers and the
    // admin's server actions call it; the shell, a face or a guest page never do.
    {
      name: 'core-service-only-from-service-callers',
      severity: 'error',
      comment:
        "Only apps/worker, the web app's route handlers (apps/web/app/api/) and its server code (apps/web/src/server/, where the server actions live) may import @restro/core/service (packages/core/src/service/).",
      from: {
        pathNot: [
          '^apps/worker/',
          '^apps/web/app/api/',
          '^apps/web/src/server/',
          '^packages/core/src/service/',
        ],
      },
      to: { path: ['^packages/core/src/service/', '^@restro/core/service(/|$)'] },
    },

    // 3 and 4. Connectors are called by the worker only (CLAUDE.md "Never": the web never calls a
    //    POS). These replace barsy-only-from-worker and web-no-barsy and cover every connector
    //    package (D67: a guard only tightens).
    {
      name: 'connectors-only-from-worker',
      severity: 'error',
      comment:
        'Only apps/worker may import a connector package (@restro/barsy, anything under packages/connectors/); a connector package may import itself.',
      from: { pathNot: ['^apps/worker/', '^packages/barsy/', '^packages/connectors/'] },
      to: { path: CONNECTOR_PACKAGES },
    },
    {
      name: 'web-no-connectors',
      severity: 'error',
      comment:
        'apps/web must not import a connector package. It reads what a connector reported from Postgres.',
      from: { path: '^apps/web/' },
      to: { path: CONNECTOR_PACKAGES },
    },

    // Paying (D127, #104). The worker makes every call to a payment provider; the web app only
    // checks a notice's signature and loads the provider's card form, each through its connector
    // folder; the notice route records the notice and does nothing else.
    {
      name: 'payments-only-from-worker',
      severity: 'error',
      comment:
        'Only apps/worker may import a payment provider package (anything under packages/payments/); a provider package may import itself.',
      from: { pathNot: ['^apps/worker/', '^packages/payments/'] },
      to: { path: PAYMENT_PACKAGES },
    },
    {
      name: 'web-provider-only-through-connectors',
      severity: 'error',
      comment:
        "apps/web may import a payment provider's libraries (stripe, @stripe/*) only in apps/web/src/connectors/<kind>/.",
      from: { path: '^apps/web/', pathNot: '^apps/web/src/connectors/[^/]+/' },
      to: { path: PROVIDER_LIBRARIES },
    },
    {
      name: 'notice-route-records-only',
      severity: 'error',
      comment:
        'The notice route (apps/web/app/api/payments/notices/) may import from @restro/core/service only its notices module (`@restro/core/service/notices`, a file or a folder, exporting `recordProviderNotice`): it stores the notice, and a worker job acts on it.',
      from: { path: '^apps/web/app/api/payments/notices/' },
      to: {
        path: ['^packages/core/src/service/', '^@restro/core/service(/|$)'],
        pathNot: ['^packages/core/src/service/notices(\\.ts$|/)', '^@restro/core/service/notices$'],
      },
    },

    // Sealed credentials (D55): the web seals with the worker's public key; only the worker
    // opens. The opening half (packages/core/src/seal/open/, `@restro/core/seal-open`) holds
    // every use of the private key, so nothing else may import it, the web app least of all.
    {
      name: 'seal-open-only-from-worker',
      severity: 'error',
      comment:
        'Only apps/worker may import @restro/core/seal-open (packages/core/src/seal/open/): opening sealed credentials needs the private key, which only the worker holds.',
      from: { pathNot: ['^apps/worker/', '^packages/core/src/seal/open/'] },
      to: { path: ['^packages/core/src/seal/open/', '^@restro/core/seal-open(/|$)'] },
    },

    // 5. Dependencies point one way: apps use packages, never the other way round.
    {
      name: 'packages-never-import-apps',
      severity: 'error',
      comment: 'Nothing under packages/ may import from apps/.',
      from: { path: '^packages/' },
      to: { path: ['^apps/', '^@restro/(web|worker)(/|$)'] },
    },
    {
      name: 'assets-no-database-or-barsy',
      severity: 'error',
      comment:
        'packages/assets (the asset store, shared by apps/web and apps/worker) must not import @restro/db, a connector or anything under apps/. The stores hold bytes and sign links; the apps own the database rows.',
      from: { path: '^packages/assets/' },
      to: {
        path: [
          '^packages/db/',
          '^@restro/db(/|$)',
          ...CONNECTOR_PACKAGES,
          '^apps/',
          '^@restro/(web|worker)(/|$)',
        ],
      },
    },

    // SH-06 (D72), the services of a face. A face's preview adapter (its `./preview` subpath, e.g.
    // `@restro/editorial-market/preview`) is a make-believe host for the admin's preview: a guest
    // page must never import it, or demo data could reach a venue's guests. And a face draws the
    // amounts the host gives it without adding them up: the money arithmetic the shell exports for
    // that adapter (`@restro/shell/money`) is for a face's `preview/` folder alone.
    {
      name: 'guest-never-imports-face-preview',
      severity: 'error',
      comment:
        'apps/web/app/m and apps/web/src/guest (the guest phone page) must not import the ./preview subpath of any face (packages/faces/*/src/preview): it is the admin-only demo host, and a guest page binds real services or none (D72).',
      from: { path: ['^apps/web/app/m/', '^apps/web/src/guest/'] },
      to: { path: ['^packages/faces/[^/]+/src/preview(/|$)', '^@restro/[^/]+/preview(/|$)'] },
    },
    {
      name: 'faces-money-math-only-in-preview',
      severity: 'error',
      comment:
        'Under packages/faces/, only a preview/ folder may import @restro/shell/money (packages/shell/src/money-math.ts): a face draws the amounts the host gives it and never adds them up (D72, rule 8).',
      from: { path: '^packages/faces/', pathNot: '(^|/)preview/' },
      to: { path: ['^packages/shell/src/money-math\\.ts$', '^@restro/shell/money(/|$)'] },
    },

    // The connector conformance kit (#65) is a test harness, like the shell's `testing` fixtures:
    // its toy POS and fault switches must never reach a connector's or an app's own code.
    {
      name: 'connector-kit-only-from-tests',
      severity: 'error',
      comment:
        'Only tests (*.test.ts) and test-* helpers may import the connector conformance kit, @restro/core/connectors/testing (packages/core/src/connectors/service/testing/); the kit may import its own files.',
      from: {
        pathNot: [
          '\\.test\\.[jt]sx?$',
          '(^|/)test-[^/]+\\.[jt]sx?$',
          '^packages/core/src/connectors/service/testing/',
        ],
      },
      to: {
        path: [
          '^packages/core/src/connectors/service/testing/',
          '^@restro/core/connectors/testing(/|$)',
        ],
      },
    },

    // The guest page (rule 4): it reads published files and nothing else. Its code (app/m and
    // src/guest) never imports the database, apply(), the asset and publish stores, or the
    // server-only helpers of the web app; it calls no server action either.
    {
      name: 'guest-page-reads-published-files-only',
      severity: 'error',
      comment:
        'apps/web/app/m and apps/web/src/guest (the guest phone page) must not import @restro/db, @restro/core/apply, @restro/core/service, @restro/assets, pg or apps/web/src/server: guest pages never read the database (rule 4).',
      from: { path: ['^apps/web/app/m/', '^apps/web/src/guest/'] },
      to: {
        path: [
          '^packages/db/',
          '^@restro/db(/|$)',
          '^packages/core/src/apply/',
          '^@restro/core/apply(/|$)',
          '^packages/core/src/service/',
          '^@restro/core/service(/|$)',
          '^packages/assets/',
          '^@restro/assets(/|$)',
          '^apps/web/src/server/',
          ...IO_PACKAGES,
        ],
      },
    },

    // 6. No cycles, including type-only imports (tsPreCompilationDeps below).
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'No circular dependencies.',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    // Look at our own code only; do not walk into installed dependencies.
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(\\.next|dist|coverage|playwright-report|test-results)(/|$)' },
    // Count `import type` too, so a type-only import of a forbidden module is still caught.
    tsPreCompilationDeps: true,
    // Resolve workspace packages through their package.json "exports" to the TypeScript source.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
}
