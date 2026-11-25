"use client"

import {
  ArrowLeftRight,
  Award,
  Building2,
  CalendarDays,
  ChevronsUpDown,
  Globe,
  Layers,
  LogOut,
  Megaphone,
  Settings,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@clubspace/ui-kit/ui"

import { signOut } from "../../../../shared/api/client"
import { fetchMe, type Me } from "../../../../shared/api/me"
import { confirmLeave } from "../../../../shared/lib/use-dirty-guard"
import { clearActiveWorkspaceId } from "../../../../shared/workspace/storage"
import { MyProfileDialog } from "../../../../features/users/MyProfileDialog"
import { useOrg } from "../../../../features/org/org-context"

// `orgAdmin`: ORG_ADMIN only (team, settings); `orgStaff`: every member of
// the federation team, ORG_COACH included — mirror of the server's @OrgRoles.
export type OrgAccess = "orgAdmin" | "orgStaff"

export type OrgNavItem = {
  key: string
  label: string
  icon: LucideIcon
  // Relative to /org/<id> ("" = «Клубы», the landing page).
  path: string
  access: OrgAccess
}

// Docs/design/2026-11-26-federation-hub-mvp.md §4.1: seven items, titles =
// page titles; settings at the bottom, apart from the work.
export const ORG_NAV: readonly OrgNavItem[] = [
  { key: "clubs", label: "Клубы", icon: Building2, path: "", access: "orgStaff" },
  { key: "registry", label: "Реестр поясов", icon: Award, path: "registry", access: "orgStaff" },
  { key: "events", label: "Календарь", icon: CalendarDays, path: "events", access: "orgStaff" },
  { key: "announcements", label: "Объявления", icon: Megaphone, path: "announcements", access: "orgStaff" },
  { key: "ladders", label: "Стандарты", icon: Layers, path: "ladders", access: "orgStaff" },
  { key: "team", label: "Команда", icon: Users, path: "team", access: "orgAdmin" },
  { key: "settings", label: "Настройки", icon: Settings, path: "settings", access: "orgAdmin" },
]

export const visibleOrgNav = (isAdmin: boolean): OrgNavItem[] =>
  ORG_NAV.filter((item) => item.access === "orgStaff" || isAdmin)

const initials = (me: Me | null) => {
  const fromName = [me?.firstname, me?.lastname]
    .map((part) => part?.trim()[0] ?? "")
    .join("")
  return (fromName || me?.email?.[0] || "?").toUpperCase()
}

export function OrgSidebar() {
  const { org, isAdmin } = useOrg()
  const pathname = usePathname()
  const router = useRouter()
  const { isMobile } = useSidebar()
  const basePath = `/org/${org.id}`
  const [me, setMe] = useState<Me | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)

  useEffect(() => {
    let alive = true
    fetchMe()
      .then((data) => alive && setMe(data))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const handleSignOut = async () => {
    if (!(await confirmLeave())) return
    clearActiveWorkspaceId()
    await signOut()
    router.replace("/sign-in")
  }

  const hrefFor = (path: string) => (path ? `${basePath}/${path}` : basePath)
  const items = visibleOrgNav(isAdmin)
  const work = items.filter((item) => item.key !== "settings")
  const settings = items.filter((item) => item.key === "settings")
  const name = [me?.firstname, me?.lastname].filter(Boolean).join(" ") || me?.email || ""

  const renderItem = (item: OrgNavItem) => {
    const href = hrefFor(item.path)
    const isActive =
      pathname === href || (item.path !== "" && pathname?.startsWith(`${href}/`))
    return (
      <SidebarMenuItem key={item.key}>
        <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
          <Link href={href}>
            <item.icon className="size-4" />
            <span>{item.label}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  return (
    <Sidebar collapsible="icon" className="border-border">
      <SidebarContent className="group-data-[collapsible=icon]:overflow-y-auto">
        {me?.isSuperAdmin && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="← Платформа">
                    <Link href="/platform">
                      <Globe className="size-4" />
                      <span>← Платформа</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>{work.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {settings.length > 0 && (
          <SidebarGroup className="mt-auto">
            <SidebarGroupContent>
              <SidebarMenu>{settings.map(renderItem)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="shrink-0 border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  tooltip={name || "Аккаунт"}
                  aria-label={`Меню аккаунта${name ? `: ${name}` : ""}`}
                  className="data-[state=open]:bg-sidebar-accent"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {initials(me)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-left">{name}</span>
                  <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side={isMobile ? "top" : "right"} align="end" className="w-60">
                {me?.email && (
                  <>
                    <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
                      {me.email}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem disabled={!me} onSelect={() => setProfileOpen(true)}>
                  <UserRound className="size-4" />
                  Мой профиль
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/workspaces">
                    <ArrowLeftRight className="size-4" />
                    Сменить клуб или федерацию
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void handleSignOut()}>
                  <LogOut className="size-4" />
                  Выйти
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
      {me && (
        <MyProfileDialog me={me} open={profileOpen} onOpenChange={setProfileOpen} onSaved={setMe} />
      )}
    </Sidebar>
  )
}
