import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { LocaleToggle } from '@/components/locale-toggle'
import { ItemFieldsPreview } from '@/fields/item-fields-preview'

export async function generateMetadata() {
  const t = await getTranslations('devFields')
  return { title: t('title') }
}

/**
 * Development-only preview of the field primitives: one FieldRow per field of the default
 * template's Item node, with sample values, so every field type can be looked at and edited
 * (locally; nothing is saved). In production the route does not exist. It needs no sign-in and no
 * database on purpose: it shows components, not data (the proxy lets /dev through for that reason).
 */
export default async function DevFieldsPage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  const t = await getTranslations('devFields')

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <LocaleToggle />
      </div>
      <ItemFieldsPreview />
    </main>
  )
}
