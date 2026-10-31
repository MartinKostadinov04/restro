'use client'

// The user menu in the sidebar footer. Ported from the Platform's SidebarLayout.jsx (279-332),
// which offered "Profile" and "API Tokens" only; Restro's has the interface language, the colour
// theme and sign-out. Every string goes through next-intl.
import { ChevronsUpDownIcon, LanguagesIcon, LogOutIcon, SunMoonIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useSyncExternalStore, useTransition } from 'react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { setAdminLocale } from '@/i18n/actions'
import { ADMIN_LOCALES } from '@/i18n/locales'
import { authClient } from '@/lib/auth-client'
import {
  isThemeChoice,
  readThemeChoice,
  setThemeChoice,
  subscribeToTheme,
  THEME_CHOICES,
} from '@/lib/theme'
import { stopPushOnThisBrowser } from '@/tonight/push-device'

interface UserMenuProps {
  name: string
  email: string
}

function initialOf(name: string): string {
  return ([...name.trim()][0] ?? '?').toUpperCase()
}

export function UserMenu({ name, email }: UserMenuProps) {
  const t = useTranslations('user')
  const tLanguage = useTranslations('language')
  const locale = useLocale()
  const router = useRouter()
  const { isMobile } = useSidebar()
  const [, startTransition] = useTransition()
  const theme = useSyncExternalStore(subscribeToTheme, readThemeChoice, () => 'system' as const)

  async function signOut() {
    await stopPushOnThisBrowser()
    await authClient.signOut()
    router.replace('/login')
    router.refresh()
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              data-testid="user-menu"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg">{initialOf(name)}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{name}</span>
                <span className="truncate text-xs text-muted-foreground">{email}</span>
              </div>
              <ChevronsUpDownIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="size-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">{initialOf(name)}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{name}</span>
                  <span className="truncate text-xs text-muted-foreground">{email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
                <LanguagesIcon className="size-3.5" aria-hidden />
                {tLanguage('label')}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={locale}
                onValueChange={(value) => startTransition(() => setAdminLocale(value))}
              >
                {ADMIN_LOCALES.map((option) => (
                  <DropdownMenuRadioItem key={option} value={option} lang={option}>
                    {tLanguage(`name.${option}`)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
                <SunMoonIcon className="size-3.5" aria-hidden />
                {t('theme')}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={(value) => {
                  if (isThemeChoice(value)) setThemeChoice(value)
                }}
              >
                {THEME_CHOICES.map((choice) => (
                  <DropdownMenuRadioItem key={choice} value={choice}>
                    {t(`themes.${choice}`)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={signOut} data-testid="sign-out">
              <LogOutIcon aria-hidden />
              {t('signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
