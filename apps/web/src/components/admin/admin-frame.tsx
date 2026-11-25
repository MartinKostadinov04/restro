'use client'

// What the admin frame knows about this sign-in, for the parts a page draws itself (its top bar):
// whether it is a shared device (D122 §7), which has no sidebar and whose name opens the language,
// theme and sign-out (D161), and whether it is a staff-only sign-in (D141), which has no venues
// list to go back to. Set once by the admin layout.
import { createContext, type ReactNode, useContext } from 'react'

/**
 * A shared device (by the name its owner gave it) is always staff-only; a person is staff-only
 * when not an owner or admin and working at one venue only (D141's landing).
 */
export type AdminFrame =
  | { readonly device: { readonly name: string }; readonly staffOnly: true }
  | { readonly device: null; readonly staffOnly: boolean }

const AdminFrameContext = createContext<AdminFrame>({ device: null, staffOnly: false })

export function AdminFrameProvider({
  value,
  children,
}: {
  value: AdminFrame
  children: ReactNode
}) {
  return <AdminFrameContext.Provider value={value}>{children}</AdminFrameContext.Provider>
}

export function useAdminFrame(): AdminFrame {
  return useContext(AdminFrameContext)
}
