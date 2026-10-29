'use client'

// Marking a table as its bar's payment table, or taking the mark away, from its card (#215; screen
// plan for #201, part A). The mark is a settings change: the person's own sign-in of the last 15
// minutes, asked again here by the owner-settings runner (`useSettingsRun`), never a PIN. Marking
// asks first on the card (it hides the table and retires its code for good); unmarking is one tap
// with Undo, and Undo marks again with no question, as a table without a code has nothing to lose.
import { useTranslations } from 'next-intl'
import { markPaymentTableAction } from '@/server/tonight/actions'
import { useSettingsRun } from '@/settings/use-settings-run'

export function usePaymentTable({
  venueId,
  tableId,
  shown,
  email,
}: {
  venueId: string
  tableId: string
  /** What the card calls the table, for the toasts. */
  shown: string
  /** The signed-in person's email, for the password again. */
  email: string
}) {
  const t = useTranslations('ownerSettings')
  const { pending, run, dialog } = useSettingsRun(email)

  // Two refusals name the table and the fix, so this screen words them itself.
  const words = (error: string): string | undefined => {
    if (error === 'table_open') return t('pt_err_open', { table: shown })
    if (error === 'payment_table_busy') return t('pt_err_busy', { table: shown })
    return undefined
  }
  const set = (isPaymentTable: boolean) => () =>
    markPaymentTableAction({ venueId, tableId, isPaymentTable })

  return {
    pending,
    /** Render once, beside the card's other dialogs: asks for the password again. */
    dialog,
    mark: () => run(set(true), { done: t('pt_marked', { table: shown }), words }),
    unmark: () =>
      run(set(false), {
        done: t('pt_unmarked', { table: shown }),
        undo: set(true),
        words,
      }),
  }
}
