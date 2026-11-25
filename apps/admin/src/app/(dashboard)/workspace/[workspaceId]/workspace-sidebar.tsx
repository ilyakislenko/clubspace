"use client"

import {
  ArrowLeftRight,
  Award,
  BarChart3,
  CalendarCheck,
  ChevronsUpDown,
  CreditCard,
  FileText,
  Gauge,
  Globe,
  LayoutDashboard,
  LogOut,
  MapPin,
  Megaphone,
  PhoneCall,
  Settings,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react"
import Link from "next/link"
import { useParams, usePathname, useRouter } from "next/navigation"
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
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@clubspace/ui-kit/ui"
import { type ClubVocabulary } from "@clubspace/ui-kit/brand"

import { signOut } from "../../../../shared/api/client"
import { fetchMe, type Me } from "../../../../shared/api/me"
import { fetchWorkspaces, isAdminWorkspace } from "../../../../shared/api/workspaces"
import { listMyOrganizations } from "../../../../shared/api/organizations"
import {
  hasAccess,
  isClubAdmin,
  type Access,
  type CurrentMembership,
} from "../../../../shared/lib/permissions"
import { confirmLeave } from "../../../../shared/lib/use-dirty-guard"
import { useMyMembership } from "../../../../shared/lib/use-my-membership"
import {
  featureOn,
  useWorkspaceFeatures,
  type WorkspaceFeature,
  type WorkspaceFeatures,
} from "../../../../shared/lib/use-workspace-features"
import { useVocabulary } from "../../../../shared/lib/vocabulary"
import {
  visibleTabs,
  type SectionTab,
} from "../../../../shared/workspace/section-tabs"
import { clearActiveWorkspaceId } from "../../../../shared/workspace/storage"
import { MyProfileDialog } from "../../../../features/users/MyProfileDialog"
import { beltTabs, memberTabs, newsTabs, reportTabs, subscriptionTabs } from "./sections"

// A sidebar entry: one route (`path`, gated by `access`) or a section of
// several routes shown as tabs (`tabs`; visible when the role may open at
// least one tab, opens the first of them, lit on all of them).
export type NavItem = {
  key: string
  label: string
  icon: LucideIcon
  // App section the item belongs to: hidden while the club has it switched
  // off in the settings (a dance studio without ranks sees no «Пояса»).
  feature?: WorkspaceFeature
} & ({ path: string; access: Access } | { tabs: readonly SectionTab[] })

export type NavGroup = {
  key: string
  // Shown only while the group holds an item of `labelAccess` (a head coach
  // sees «Отчёты» without the money, so not under «Деньги»).
  label?: string
  labelAccess?: Access
  items: NavItem[]
}

// Docs/design/2026-11-08-admin-cleanup.md §3: everyday work first, money,
// the club's content, settings at the bottom. Titles = page titles.
export const navGroups = (vocabulary: ClubVocabulary): NavGroup[] => [
  {
    key: "daily",
    label: "Каждый день",
    items: [
      { key: "dashboard", label: "Сегодня", icon: LayoutDashboard, path: "", access: "staff" },
      { key: "schedule", label: "Расписание", icon: CalendarCheck, path: "schedule", access: "staff" },
      { key: "users", label: "Ученики", icon: Users, tabs: memberTabs },
      { key: "retention", label: "Удержание", icon: PhoneCall, path: "retention", access: "staff" },
    ],
  },
  {
    key: "money",
    label: "Деньги",
    labelAccess: "clubAdmin",
    items: [
      { key: "subscriptions", label: "Абонементы", icon: CreditCard, tabs: subscriptionTabs },
      { key: "reports", label: "Отчёты", icon: BarChart3, tabs: reportTabs(vocabulary) },
    ],
  },
  {
    key: "club",
    label: "Клуб",
    items: [
      { key: "groups", label: "Группы и залы", icon: MapPin, path: "groups", access: "lead" },
      { key: "belts", label: "Пояса", icon: Award, tabs: beltTabs, feature: "ranks" },
      { key: "content", label: "Курсы и видео", icon: FileText, path: "content", access: "lead", feature: "videos" },
      { key: "news", label: "Новости и события", icon: Megaphone, tabs: newsTabs },
    ],
  },
  {
    key: "system",
    items: [
      { key: "settings", label: "Настройки", icon: Settings, path: "settings", access: "clubAdmin" },
    ],
  },
]

export type ResolvedNavItem = {
  key: string
  label: string
  icon: LucideIcon
  // Workspace-relative route the item opens.
  path: string
  // Workspace-relative routes that light the item up (with their subroutes).
  matchPaths: string[]
}

// The items this role sees in this club, with the route each opens. Gated
// items stay hidden until the membership has loaded.
export const resolveNavItems = (
  items: readonly NavItem[],
  membership: CurrentMembership | null | undefined,
  features: WorkspaceFeatures | null,
): ResolvedNavItem[] =>
  items.flatMap((item) => {
    if (item.feature && !featureOn(features, item.feature)) return []
    const base = { key: item.key, label: item.label, icon: item.icon }
    if ("tabs" in item) {
      const shown = visibleTabs(item.tabs, membership, features)
      if (shown.length === 0) return []
      return [{ ...base, path: shown[0].path, matchPaths: shown.map((t) => t.path) }]
    }
    if (!hasAccess(membership, item.access)) return []
    return [{ ...base, path: item.path, matchPaths: [item.path] }]
  })

const initials = (me: Me | null) => {
  const fromName = [me?.firstname, me?.lastname]
    .map((part) => part?.trim()[0] ?? "")
    .join("")
  return (fromName || me?.email?.[0] || "?").toUpperCase()
}

export function WorkspaceSidebar() {
  const params = useParams<{ workspaceId: string }>()
  const vocabulary = useVocabulary()
  const pathname = usePathname()
  const router = useRouter()
  const { isMobile } = useSidebar()
  const workspaceId = params?.workspaceId ?? ""
  const basePath = `/workspace/${workspaceId}`
  const membership = useMyMembership(workspaceId)

  // The account menu's name, and platform staff get a direct way back to the
  // console («Сменить клуб» → /workspaces → /platform was two steps).
  const [me, setMe] = useState<Me | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  // «Сменить клуб» only when there is another club to switch to: with one,
  // /workspaces sends the account straight back here. On a federation's team
  // too: it also leads to the federation.
  const [adminClubs, setAdminClubs] = useState(0)
  const [hasOrganization, setHasOrganization] = useState(false)
  useEffect(() => {
    let alive = true
    fetchMe()
      .then((data) => alive && setMe(data))
      .catch(() => undefined)
    fetchWorkspaces()
      .then((list) => alive && setAdminClubs(list.filter(isAdminWorkspace).length))
      .catch(() => undefined)
    listMyOrganizations()
      .then((orgs) => alive && setHasOrganization(orgs.length > 0))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  // The club's app sections, re-read on every navigation: a section switched
  // off in the settings leaves the menu on the next page.
  const features = useWorkspaceFeatures(workspaceId, pathname)

  const handleSignOut = async () => {
    if (!(await confirmLeave())) return
    clearActiveWorkspaceId()
    await signOut()
    router.replace("/sign-in")
  }

  const hrefFor = (path: string) => (path ? `${basePath}/${path}` : basePath)

  const renderNavItem = (item: ResolvedNavItem) => {
    const isActive = item.matchPaths.some((path) => {
      const href = hrefFor(path)
      return pathname === href || (path !== "" && pathname?.startsWith(`${href}/`))
    })
    return (
      <SidebarMenuItem key={item.key}>
        <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
          <Link href={hrefFor(item.path)}>
            <item.icon className="size-4" />
            <span>{item.label}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  const groups = navGroups(vocabulary)
    .map((group) => ({
      ...group,
      resolved: resolveNavItems(group.items, membership, features),
    }))
    .filter((group) => group.resolved.length > 0)
  const name =
    [me?.firstname, me?.lastname].filter(Boolean).join(" ") || me?.email || ""

  // `icon`: collapsing leaves a strip of icons (labels come back as tooltips)
  // instead of hiding navigation entirely — on a 1024 tablet it starts that
  // way (see `defaultSidebarOpen`). The strip has no room for the group
  // labels, so the list itself scrolls there, as it does when expanded.
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
        {groups.map((group) => {
          const showLabel =
            group.label &&
            (!group.labelAccess || hasAccess(membership, group.labelAccess))
          return (
            <SidebarGroup
              key={group.key}
              // Settings sit at the bottom of the list, apart from the club.
              className={group.label ? undefined : "mt-auto"}
            >
              {showLabel && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
              <SidebarGroupContent>
                <SidebarMenu>{group.resolved.map(renderNavItem)}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )
        })}
      </SidebarContent>
      {/* Only SidebarContent scrolls (flex-1, min-h-0); the footer never
          shrinks and is bordered off, so on a 900px screen the list scrolls
          above it instead of running into the account menu. */}
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
              <DropdownMenuContent
                side={isMobile ? "top" : "right"}
                align="end"
                className="w-60"
              >
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
                {isClubAdmin(membership) && (
                  <DropdownMenuItem asChild>
                    <Link href={`${basePath}/billing`}>
                      <Gauge className="size-4" />
                      Подписка ClubSpace
                    </Link>
                  </DropdownMenuItem>
                )}
                {(adminClubs > 1 || hasOrganization || me?.isSuperAdmin) && (
                  <DropdownMenuItem asChild>
                    <Link href="/workspaces">
                      <ArrowLeftRight className="size-4" />
                      {hasOrganization ? "Сменить клуб или федерацию" : "Сменить клуб"}
                    </Link>
                  </DropdownMenuItem>
                )}
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
        <MyProfileDialog
          me={me}
          open={profileOpen}
          onOpenChange={setProfileOpen}
          onSaved={setMe}
        />
      )}
    </Sidebar>
  )
}
