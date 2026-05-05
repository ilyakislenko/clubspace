"use client"

import {
  CreditCard,
  FileText,
  History,
  LayoutDashboard,
  MapPin,
  Settings,
  Users,
} from "lucide-react"
import Link from "next/link"
import { useParams, usePathname } from "next/navigation"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@bjj-academy/ui-kit/ui"

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
    key: "settings",
    label: "Настройки",
    icon: Settings,
    path: "settings",
  },
]

export function WorkspaceSidebar() {
  const params = useParams<{ workspaceId: string }>()
  const pathname = usePathname()
  const workspaceId = params?.workspaceId ?? ""
  const basePath = `/workspace/${workspaceId}`

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
      <SidebarRail />
    </Sidebar>
  )
}
