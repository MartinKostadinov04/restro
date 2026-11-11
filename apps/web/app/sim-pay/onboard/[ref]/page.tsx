import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { paymentsEnv } from '@/connectors/notices'
import { providerOf } from '@/connectors/providers'
import { SimAccountRefSchema, simPayOnboardingOffered } from '@/connectors/sim-pay/onboarding'
import { SimPayOnboardingForm } from '@/connectors/sim-pay/onboarding-form'
import { requireTenant } from '@/server/session'
import { payingInstallation, payingReturnAddress } from '@/server/settings/paying-addresses'
import { getVenue } from '@/server/venues'

export const metadata = { robots: { index: false } }

/**
 * The page that stands in for the simulated card provider's own onboarding form (#398), where the
 * owner lands from "Connect" in Settings > Paying. A real provider's form is on its own site; the
 * simulator has none, so this says so in plain words and has a "Done" that finishes the simulated
 * account and sends the owner back to the Paying settings, as the real form's end does.
 *
 * It does not exist in production (404): the worker refuses the simulator there too, and each
 * guard holds alone (see connectors/sim-pay/onboarding.ts). Signed-in people only (the proxy sends
 * the rest to sign in), and only for a venue of the person's own organisation.
 */
export default async function SimPayOnboardingPage({
  params,
  searchParams,
}: PageProps<'/sim-pay/onboard/[ref]'>) {
  if (!simPayOnboardingOffered(paymentsEnv())) notFound()
  const { organization } = await requireTenant()
  const ref = SimAccountRefSchema.safeParse((await params).ref)
  const query = await searchParams
  const venueId = typeof query.venue === 'string' ? query.venue : ''
  const where = payingInstallation()
  if (!ref.success || where === null) notFound()
  const venue = await getVenue(organization.id, venueId)
  if (!venue) notFound()
  // The links the settings sent to the provider are the only ones this page leads back to.
  const back = payingReturnAddress(where.base, venue.id, 'return')
  const refresh = payingReturnAddress(where.base, venue.id, 'refresh')
  if (query.return !== back || query.refresh !== refresh) notFound()

  const t = await getTranslations('simPayOnboarding')
  const provider = providerOf('sim-pay')?.label ?? 'Test card payments'

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col justify-center gap-6 px-4 py-10">
      <p
        data-testid="sim-pay-badge"
        className="w-fit rounded-md border border-dashed px-2 py-1 text-xs font-medium text-muted-foreground"
      >
        {t('badge')}
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">{t('heading', { provider })}</h1>
      <p data-testid="sim-pay-stands-in" className="text-sm text-muted-foreground">
        {t('standsIn', { provider })}
      </p>
      <p className="text-sm text-muted-foreground">{t('what')}</p>
      <SimPayOnboardingForm
        accountRef={ref.data}
        venueId={venue.id}
        returnUrl={back}
        refreshUrl={refresh}
      />
      <div className="flex flex-col gap-1 text-sm">
        <a data-testid="sim-pay-leave" href={back} className="w-fit underline underline-offset-4">
          {t('leave')}
        </a>
        <span className="text-muted-foreground">{t('leaveHint')}</span>
      </div>
    </main>
  )
}
