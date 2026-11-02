"use client"

import {
  ArrowLeftRight,
  Award,
  Trophy,
  Bot,
  CalendarCheck,
  CalendarDays,
  CreditCard,
  FileText,
  GraduationCap,
  History,
  LayoutDashboard,
  Gauge,
  Layers,
  Globe,
  LogOut,
  MapPin,
  Megaphone,
  Settings,
  Sparkles,
  UserX,
  Upload,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react"
import Link from "next/link"
import { useParams, usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import {
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
} from "@clubspace/ui-kit/ui"

import { signOut } from "../../../../shared/api/client"
import { fetchMe } from "../../../../shared/api/me"
import { visibleNavItems } from "../../../../shared/lib/permissions"
import { useMyMembership } from "../../../../shared/lib/use-my-membership"
import {
  featureOn,
  useWorkspaceFeatures,
  type WorkspaceFeature,
} from "../../../../shared/lib/use-workspace-features"
import { clearActiveWorkspaceId } from "../../../../shared/workspace/storage"
import { ANALYTICS_SECTIONS } from "./analytics/sections"

type NavItem = {
  key: string
  label: string
  icon: LucideIcon
  path: string
  adminOnly?: boolean
  adminOrDirectionManager?: boolean
  // App section the item belongs to: hidden while the club has it switched
  // off in the settings (a dance studio without ranks sees no «Аттестации»).
  feature?: WorkspaceFeature
}

// The daily pair (Обзор, Кто пропадает) is its own group so «Аналитика» can sit
// right under it instead of below «Тариф», where owners had to scroll for it.
const dailyNavItems: NavItem[] = [
  {
    key: "dashboard",
    label: "Обзор",
    icon: LayoutDashboard,
    path: "",
  },
  {
    key: "retention",
    label: "Кто пропадает",
    icon: UserX,
    path: "retention",
  },
]

const manageNavItems: NavItem[] = [
  {
    key: "users",
    label: "Участники",
    icon: Users,
    path: "users",
  },
  {
    key: "club-import",
    label: "Импорт клуба",
    icon: Upload,
    path: "club-import",
    adminOnly: true,
  },
  {
    key: "groups",
    label: "Группы и расписание",
    icon: MapPin,
    path: "groups",
  },
  {
    key: "schedule",
    label: "Занятия",
    icon: CalendarCheck,
    path: "schedule",
  },
  {
    key: "directions",
    label: "Направления",
    icon: Layers,
    path: "directions",
    adminOnly: true,
  },
  {
    key: "content",
    label: "Курсы и видео",
    icon: FileText,
    path: "content",
    feature: "videos",
  },
  {
    key: "ranks",
    label: "Ранги",
    icon: Award,
    path: "ranks",
    adminOrDirectionManager: true,
    feature: "ranks",
  },
  {
    key: "gradings",
    label: "Аттестации",
    icon: GraduationCap,
    path: "gradings",
    feature: "ranks",
  },
  {
    key: "subscriptions",
    label: "Тарифы и абонементы",
    icon: CreditCard,
    path: "subscriptions",
    adminOrDirectionManager: true,
  },
  {
    key: "payments",
    label: "Онлайн-оплата",
    icon: Wallet,
    path: "payments",
    adminOnly: true,
  },
  {
    key: "events",
    label: "События",
    icon: CalendarDays,
    path: "events",
  },
  {
    key: "announcements",
    label: "Объявления",
    icon: Megaphone,
    path: "announcements",
    adminOrDirectionManager: true,
  },
  {
    key: "achievements",
    label: "Достижения",
    icon: Trophy,
    path: "achievements",
    adminOrDirectionManager: true,
    feature: "achievements",
  },
  {
    key: "audit",
    label: "История изменений",
    icon: History,
    path: "audit",
  },
  {
    key: "public-page",
    label: "Публичная страница",
    icon: Globe,
    path: "public-page",
    adminOnly: true,
  },
  {
    key: "settings",
    label: "Настройки",
    icon: Settings,
    path: "settings",
    adminOnly: true,
  },
  {
    // ИИ-ассистент (MCP): admins and руководители направлений.
    key: "integrations",
    label: "Интеграции",
    icon: Bot,
    path: "integrations",
    adminOrDirectionManager: true,
  },
  {
    key: "billing",
    label: "Тариф",
    icon: Gauge,
    path: "billing",
    adminOnly: true,
  },
]

// «Аналитика» is staff-wide: no adminOnly flags, the server scopes the numbers.
// The ИИ-ассистент chat closes the group: admins and руководители направлений.
const analyticsNavItems: NavItem[] = [
  ...ANALYTICS_SECTIONS.map((s) => ({
    key: s.key,
    label: s.label,
    icon: s.icon,
    path: `analytics/${s.path}`,
  })),
  {
    key: "ai-assistant",
    label: "ИИ-ассистент",
    icon: Sparkles,
    path: "ai-assistant",
    adminOrDirectionManager: true,
  },
]

export function WorkspaceSidebar() {
  const params = useParams<{ workspaceId: string }>()
  const pathname = usePathname()
  const router = useRouter()
  const workspaceId = params?.workspaceId ?? ""
  const basePath = `/workspace/${workspaceId}`
  const membership = useMyMembership(workspaceId)

  // Platform staff get a direct way back to the console. Without it the only
  // route out is «Сменить клуб» → /workspaces → /platform: two steps, pinned to
  // the bottom edge of the sidebar, and labelled nothing like "platform".
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  useEffect(() => {
    let alive = true
    fetchMe()
      .then((me) => alive && setIsPlatformAdmin(me.isSuperAdmin))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  // The club's app sections, re-read on every navigation: a section switched
  // off in the settings leaves the menu on the next page.
  const features = useWorkspaceFeatures(workspaceId, pathname)
  const sectionOn = (item: NavItem) =>
    !item.feature || featureOn(features, item.feature)

  const handleSignOut = async () => {
    clearActiveWorkspaceId()
    await signOut()
    router.replace("/sign-in")
  }

  const renderNavItem = (item: NavItem) => {
    const href = item.path ? `${basePath}/${item.path}` : basePath
    const isActive = Boolean(
      pathname === href || (item.path && pathname?.startsWith(`${href}/`)),
    )

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

  // `icon`: collapsing leaves a strip of icons (labels come back as tooltips)
  // instead of hiding navigation entirely — on a 1024 tablet it starts that
  // way (see `defaultSidebarOpen`). The strip has no room for the group
  // labels, so the list itself scrolls there, as it does when expanded.
  return (
    <Sidebar collapsible="icon" className="border-border">
      <SidebarContent className="group-data-[collapsible=icon]:overflow-y-auto">
        {isPlatformAdmin && (
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
          <SidebarGroupLabel>Клуб</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleNavItems(dailyNavItems, membership).map(renderNavItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          {/* Faded out in the icon strip — and then must not catch clicks
              meant for the item it overlaps. */}
          <SidebarGroupLabel
            asChild
            className="group-data-[collapsible=icon]:pointer-events-none"
          >
            <Link href={`${basePath}/analytics`}>Аналитика</Link>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleNavItems(analyticsNavItems, membership).map(
                renderNavItem,
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Управление</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleNavItems(manageNavItems, membership)
                .filter(sectionOn)
                .map(renderNavItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {/* Only SidebarContent scrolls (flex-1, min-h-0); the footer never
          shrinks and is bordered off, so on a 900px screen the list scrolls
          above it instead of running into «Сменить клуб» / «Выйти». */}
      <SidebarFooter className="shrink-0 border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Сменить клуб">
              <Link href="/workspaces">
                <ArrowLeftRight className="size-4" />
                <span>Сменить клуб</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleSignOut} tooltip="Выйти">
              <LogOut className="size-4" />
              <span>Выйти</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
