"use client"

import {
  ArrowLeftRight,
  Award,
  Trophy,
  CalendarDays,
  CreditCard,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  MapPin,
  Megaphone,
  Settings,
  Users,
} from "lucide-react"
import Link from "next/link"
import { useParams, usePathname, useRouter } from "next/navigation"

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
} from "@bjj-academy/ui-kit/ui"

import { signOut } from "../../../../shared/api/client"
import { clearActiveWorkspaceId } from "../../../../shared/workspace/storage"

const navItems = [
  {
    key: "dashboard",
    label: "Дэшборд",
    description: "Обзор",
    icon: LayoutDashboard,
    path: "",
  },
  {
    key: "content",
    label: "Контент",
    icon: FileText,
    path: "content",
  },
  {
    key: "users",
    label: "Участники",
    icon: Users,
    path: "users",
  },
  {
    key: "groups",
    label: "Группы",
    icon: MapPin,
    path: "groups",
  },
  {
    key: "events",
    label: "Ивенты",
    icon: CalendarDays,
    path: "events",
  },
  {
    key: "announcements",
    label: "Объявления",
    icon: Megaphone,
    path: "announcements",
  },
  {
    key: "audit",
    label: "Журнал",
    icon: History,
    path: "audit",
  },
  {
    key: "subscriptions",
    label: "Подписки",
    icon: CreditCard,
    path: "subscriptions",
  },
  {
    key: "ranks",
    label: "Ранги",
    icon: Award,
    path: "ranks",
  },
  {
    key: "achievements",
    label: "Ачивки",
    icon: Trophy,
    path: "achievements",
  },
  {
    key: "settings",
    label: "Настройки",
    icon: Settings,
    path: "settings",
  },
]

export function WorkspaceSidebar() {
  const params = useParams<{ workspaceId: string }>()
  const pathname = usePathname()
  const router = useRouter()
  const workspaceId = params?.workspaceId ?? ""
  const basePath = `/workspace/${workspaceId}`

  const handleSignOut = async () => {
    clearActiveWorkspaceId()
    await signOut()
    router.replace("/sign-in")
  }

  return (
    <Sidebar className="border-border">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
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
                        <span>
                          {item.label}
                          {item.description ? ` (${item.description})` : ""}
                        </span>
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
