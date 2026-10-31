import { brandFromWorkspaceType } from "@clubspace/ui-kit/brand"

import type { WorkspaceSummary } from "../../shared/api/workspaces"
import { formatRoleName } from "../../shared/role-labels"
import { formatBadge } from "../notifications/unread"

// Only what a club row shows, so specs (and older cached lists) stay small.
export type ClubRowData = Pick<
  WorkspaceSummary,
  | "workspaceId"
  | "name"
  | "type"
  | "roleName"
  | "isOwner"
  | "accessExpired"
  | "notificationsMuted"
  | "unreadNotifications"
>

// Clubs with live access first, then alphabetically — a stable order, so a
// club doesn't jump around the list after a switch.
export const sortClubs = <T extends ClubRowData>(clubs: readonly T[]): T[] =>
  [...clubs].sort(
    (a, b) =>
      Number(a.accessExpired) - Number(b.accessExpired) ||
      a.name.localeCompare(b.name, "ru"),
  )

export const clubEmoji = (type: string | null | undefined): string =>
  brandFromWorkspaceType(type).emoji

// The owner has no member role of their own, so the label says it outright.
export const clubRoleLabel = (club: Pick<ClubRowData, "isOwner" | "roleName">): string =>
  club.isOwner ? "Владелец" : formatRoleName(club.roleName)

export const clubStatusLabel = (club: Pick<ClubRowData, "accessExpired">): string | null =>
  club.accessExpired ? "доступ истёк" : null

// «Тренер · доступ истёк» — the line under a club's name.
export const clubSubtitle = (club: ClubRowData): string =>
  [clubRoleLabel(club), clubStatusLabel(club)].filter(Boolean).join(" · ")

// Unread counter text (the inbox bell's «99+» format); null hides the badge.
// The guard also hides it for a list cached before the server sent the counter.
export const unreadBadgeText = (count: number | null | undefined): string | null =>
  count != null && count > 0 ? formatBadge(Math.floor(count)) : null

// Unread in clubs other than the current one: the header dot says «something
// is waiting elsewhere» without opening the switcher.
export const unreadElsewhere = (
  clubs: readonly Pick<ClubRowData, "workspaceId" | "unreadNotifications">[],
  currentId: string | null | undefined,
): number =>
  clubs.reduce(
    (sum, c) =>
      c.workspaceId === currentId || !(c.unreadNotifications > 0)
        ? sum
        : sum + c.unreadNotifications,
    0,
  )

export const clubAccessibilityLabel = (club: ClubRowData, current: boolean): string =>
  [
    `Клуб ${club.name}`,
    clubSubtitle(club),
    club.notificationsMuted ? "уведомления выключены" : null,
    unreadBadgeText(club.unreadNotifications)
      ? `непрочитанных: ${unreadBadgeText(club.unreadNotifications)}`
      : null,
    current ? "текущий" : null,
  ]
    .filter(Boolean)
    .join(", ")
