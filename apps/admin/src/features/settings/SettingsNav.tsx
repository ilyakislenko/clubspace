"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"

import type { ClubVocabulary } from "@clubspace/ui-kit/brand"

import { listClubOrganizations } from "../../shared/api/organizations"
import { useVocabulary } from "../../shared/lib/vocabulary"

// Sections of «Настройки», in menu order. `path` is relative to
// `/workspace/<id>/settings` ("" = the default section). «Федерация» only
// once a federation invited the club (a club never invited sees no item).
export const settingsSections = (
  v: ClubVocabulary,
  { federation }: { federation: boolean },
): Array<{ path: string; label: string }> => [
  { path: "", label: "Профиль клуба" },
  { path: "directions", label: "Направления" },
  { path: "access", label: `Права ${v.coach.genPl} и запись` },
  { path: "app", label: "Приложение учеников" },
  { path: "payments", label: "Оплата" },
  { path: "integrations", label: "Интеграции" },
  { path: "notifications", label: "Уведомления" },
  ...(federation ? [{ path: "federation", label: "Федерация" }] : []),
  { path: "audit", label: "История изменений" },
]

export function SettingsNav({ workspaceId }: { workspaceId: string }) {
  const vocabulary = useVocabulary()
  const pathname = usePathname() ?? ""
  const base = `/workspace/${workspaceId}/settings`
  const [federation, setFederation] = useState(false)

  useEffect(() => {
    let alive = true
    listClubOrganizations({ workspaceId })
      .then((links) => alive && setFederation(links.length > 0))
      .catch(() => alive && setFederation(false))
    return () => {
      alive = false
    }
  }, [workspaceId])

  return (
    <nav
      aria-label="Разделы настроек"
      data-section-tabs=""
      className="-mx-1 flex gap-1 overflow-x-auto pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:pb-0"
    >
      {settingsSections(vocabulary, { federation }).map((section) => {
        const href = section.path ? `${base}/${section.path}` : base
        const active = section.path
          ? pathname === href || pathname.startsWith(`${href}/`)
          : pathname === base
        return (
          <Link
            key={section.path}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            }`}
          >
            {section.label}
          </Link>
        )
      })}
    </nav>
  )
}

// Heading of one settings section: the title the menu shows, an optional
// explanation and at most one action on the right.
export function SettingsSectionHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
}
