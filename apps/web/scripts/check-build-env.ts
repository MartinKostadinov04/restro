// The public values a deployed web build inlines, checked before `next build` by the Dockerfile's
// `web` target (and nowhere else: not next.config.ts, not the guest shell, so a local build and the
// import rules are untouched). `next build` replaces every `NEXT_PUBLIC_*` it finds with the value
// it sees, and a missing one is silently empty: a guest page with no CDN address, no human check
// or no card form. So a deployed build stops here instead, naming the variables, never a value.
//
// The payment provider's publishable key must be a test key unless the build says it is for
// production (PAYMENTS_ENV=production, the setting that means real money for the web app and the
// worker alike), and then it must be a live key: the same rule the worker applies to its secret key
// (`stripeKeyMode` in packages/payments/stripe/src/config.ts, which the web app may not import).
//
//   node apps/web/scripts/check-build-env.ts      (exits 1 and lists the problems)

/** The values the guest bundle needs in a deployed build. */
export const REQUIRED_PUBLIC_VARIABLES = [
  'NEXT_PUBLIC_CDN_BASE_URL',
  'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
] as const

/** One line per problem, "<VARIABLE> <what is wrong>"; empty when the build may go on. */
export function buildEnvProblems(env: Readonly<Record<string, string | undefined>>): string[] {
  const problems: string[] = []
  const value = (name: string) => env[name]?.trim() ?? ''

  for (const name of REQUIRED_PUBLIC_VARIABLES) {
    if (value(name) === '') problems.push(`${name} is not set.`)
  }

  const cdn = value('NEXT_PUBLIC_CDN_BASE_URL')
  if (cdn !== '' && !isHttpsAddress(cdn)) {
    problems.push(
      'NEXT_PUBLIC_CDN_BASE_URL must be an absolute https:// address (the table links redirect to it).',
    )
  }

  const siteKey = value('NEXT_PUBLIC_TURNSTILE_SITE_KEY')
  if (siteKey !== '' && !/^[A-Za-z0-9_-]{1,100}$/.test(siteKey)) {
    problems.push('NEXT_PUBLIC_TURNSTILE_SITE_KEY must be a site key (letters, digits, - and _).')
  }

  const publishableKey = value('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY')
  if (publishableKey !== '') {
    const production = value('PAYMENTS_ENV').toLowerCase() === 'production'
    if (production && !publishableKey.startsWith('pk_live_')) {
      problems.push(
        'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must be a live publishable key (pk_live_) in a production build.',
      )
    }
    if (!production && !publishableKey.startsWith('pk_test_')) {
      problems.push(
        'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must be a test publishable key (pk_test_) unless the build is for production (PAYMENTS_ENV=production).',
      )
    }
  }
  return problems
}

function isHttpsAddress(text: string): boolean {
  try {
    const url = new URL(text)
    return url.protocol === 'https:' && url.hostname !== ''
  } catch {
    return false
  }
}

if (import.meta.main) {
  const problems = buildEnvProblems(process.env)
  if (problems.length > 0) {
    console.error(`The web build is refused:\n- ${problems.join('\n- ')}`)
    process.exit(1)
  }
  console.info('The web build has every public value it needs.')
}
