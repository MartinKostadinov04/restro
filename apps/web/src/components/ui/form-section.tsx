// Ported from the Synex Platform (resources/js/Components/FormSection.jsx, with SectionTitle):
// a settings block with the title and description in a left column and the fields in a card.
// Changed: no hard-coded colours, no mandatory <form> (Stage 1 settings are read-only), and an
// optional footer for actions.
import type * as React from 'react'

import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface FormSectionProps {
  title: React.ReactNode
  description?: React.ReactNode
  /** Buttons, right-aligned under the fields. */
  actions?: React.ReactNode
  className?: string
  children: React.ReactNode
}

function FormSection({ title, description, actions, className, children }: FormSectionProps) {
  return (
    <section data-slot="form-section" className={cn('md:grid md:grid-cols-3 md:gap-6', className)}>
      <div className="md:col-span-1">
        <h3 className="text-lg font-medium text-foreground">{title}</h3>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <Card className="mt-5 md:col-span-2 md:mt-0">
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
        {actions ? <CardFooter className="justify-end">{actions}</CardFooter> : null}
      </Card>
    </section>
  )
}

export { FormSection }
