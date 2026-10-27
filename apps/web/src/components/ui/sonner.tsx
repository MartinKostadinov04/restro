'use client'

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

import { readThemeChoice, subscribeToTheme } from '@/lib/theme'

// The one Toaster of the admin, mounted once in the root layout. It follows our own theme
// choice (lib/theme.ts) instead of next-themes.
const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useSyncExternalStore(subscribeToTheme, readThemeChoice, () => 'system' as const)

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      toastOptions={{ duration: 8000 }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
