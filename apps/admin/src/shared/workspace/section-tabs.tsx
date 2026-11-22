"use client"

import Link from "next/link"
import { useParams, usePathname } from "next/navigation"
import { useRef, type KeyboardEvent } from "react"

import { visibleNavItems, type Access } from "../lib/permissions"
import { useMyMembership } from "../lib/use-my-membership"
import {
  featureOn,
  useWorkspaceFeatures,
  type WorkspaceFeature,
} from "../lib/use-workspace-features"

// One tab of a sidebar section that spans several routes («Отчёты»,
// «Абонементы», «Пояса», «Новости и события»). `path` is relative to
// /workspace/<id>/; `access` matches the route's gate.
export type SectionTab = {
  key: string
  label: string
  path: string
  access: Access
  feature?: WorkspaceFeature
}

const tabHref = (basePath: string, path: string) =>
  path ? `${basePath}/${path}` : basePath

// The tab the URL is on: exact or nested match, the longest path winning, so
// /subscriptions/payments lights «Платежи», not «Тарифы» (/subscriptions).
export const activeTabKey = (
  tabs: readonly SectionTab[],
  basePath: string,
  pathname: string | null,
): string | null => {
  if (!pathname) return null
  let best: SectionTab | null = null
  for (const tab of tabs) {
    const href = tabHref(basePath, tab.path)
    const matches = pathname === href || pathname.startsWith(`${href}/`)
    if (matches && (!best || tab.path.length > best.path.length)) best = tab
  }
  return best?.key ?? null
}

// Tabs the role may open in this club: hidden while the membership loads
// (gated tabs never flash in) and when the club has the section switched off.
export const visibleTabs = (
  tabs: readonly SectionTab[],
  membership: Parameters<typeof visibleNavItems>[1],
  features: Parameters<typeof featureOn>[0],
): SectionTab[] =>
  visibleNavItems(tabs, membership).filter(
    (tab) => !tab.feature || featureOn(features, tab.feature),
  )

// The section's title (= its sidebar label) and its tabs as links: the URL is
// the state, so a tab can be bookmarked, opened in a new tab and the back
// button works. Arrow keys / Home / End move between tabs. A lone tab renders
// no tab row.
export function SectionTabs({
  title,
  tabs,
}: {
  title: string
  tabs: readonly SectionTab[]
}) {
  const params = useParams<{ workspaceId: string }>()
  const pathname = usePathname()
  const workspaceId = params?.workspaceId
  const basePath = `/workspace/${workspaceId ?? ""}`
  const membership = useMyMembership(workspaceId)
  const features = useWorkspaceFeatures(workspaceId)
  const navRef = useRef<HTMLElement>(null)

  const shown = visibleTabs(tabs, membership, features)
  const active = activeTabKey(shown, basePath, pathname)

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const links = Array.from(
      navRef.current?.querySelectorAll<HTMLAnchorElement>("a") ?? [],
    )
    const current = links.indexOf(document.activeElement as HTMLAnchorElement)
    if (current < 0) return
    const next =
      event.key === "ArrowRight"
        ? (current + 1) % links.length
        : event.key === "ArrowLeft"
          ? (current - 1 + links.length) % links.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? links.length - 1
              : null
    if (next === null) return
    event.preventDefault()
    links[next]?.focus()
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {shown.length > 1 && (
        <nav
          ref={navRef}
          aria-label={title}
          data-section-tabs=""
          onKeyDown={onKeyDown}
          className="flex overflow-x-auto border-b border-border"
        >
          {shown.map((tab) => {
            const isActive = tab.key === active
            return (
              <Link
                key={tab.key}
                href={tabHref(basePath, tab.path)}
                aria-current={isActive ? "page" : undefined}
                className={`relative -mb-px shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                  isActive
                    ? "border-b-2 border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>
      )}
    </div>
  )
}
