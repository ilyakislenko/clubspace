"use client"

import {
  ArrowLeftRight,
  Award,
  Trophy,
  CalendarDays,
  CreditCard,
  FileText,
  GraduationCap,
  History,
  LayoutDashboard,
  Globe,
  LogOut,
  MapPin,
  Megaphone,
  Settings,
  UserX,
  Users,
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
import { clearActiveWorkspaceId } from "../../../../shared/workspace/storage"

const navItems = [
  {
    key: "dashboard",
    label: "Обзор",
    icon: LayoutDashboard,
    path: "",
  },
  {
    key: "users",
    label: "Участники",
    icon: Users,
    path: "users",
  },
  {
    key: "retention",
    label: "Кто пропадает",
    icon: UserX,
    path: "retention",
  },
  {
    key: "groups",
    label: "Группы и расписание",
    icon: MapPin,
    path: "groups",
  },
  {
    key: "content",
    label: "Курсы и видео",
    icon: FileText,
    path: "content",
  },
  {
    key: "ranks",
    label: "Ранги",
    icon: Award,
    path: "ranks",
    adminOnly: true,
  },
  {
    key: "gradings",
    label: "Аттестации",
    icon: GraduationCap,
    path: "gradings",
  },
  {
    key: "subscriptions",
    label: "Тарифы и абонементы",
    icon: CreditCard,
    path: "subscriptions",
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
    adminOnly: true,
  },
  {
    key: "achievements",
    label: "Достижения",
    icon: Trophy,
    path: "achievements",
    adminOnly: true,
  },
  {
    key: "audit",
    label: "История изменений",
    icon: History,
    path: "audit",
  },
  {
    key: "settings",
    label: "Настройки",
    icon: Settings,
    path: "settings",
    adminOnly: true,
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

  const handleSignOut = async () => {
    clearActiveWorkspaceId()
    await signOut()
    router.replace("/sign-in")
  }

  return (
    <Sidebar className="border-border">
      <SidebarContent>
        {isPlatformAdmin && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
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
              {visibleNavItems(navItems, membership).map((item) => {
                const href = item.path ? `${basePath}/${item.path}` : basePath
                const isActive = Boolean(
                  pathname === href ||
                  (item.path && pathname?.startsWith(`${href}/`)),
                )

                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link href={href}>
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link href="/workspaces">
                <ArrowLeftRight className="size-4" />
                <span>Сменить клуб</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleSignOut}>
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
