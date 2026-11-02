import { vocabularyForWorkspaceType } from "@clubspace/ui-kit/brand"

import type { Invitation } from "../../shared/api/invitations"
import { MONTHS_OF_RU, pluralRu } from "../../shared/format-ru"

// «Приглашает вас как ученика/тренера» — the role the club offers, in the
// inviting club's words («как педагога» from a dance studio).
export const invitationRoleLine = (
  inv: Pick<Invitation, "roleName" | "workspaceType">,
): string =>
  inv.roleName === "coach"
    ? `Приглашает вас как ${vocabularyForWorkspaceType(inv.workspaceType).coach.gen}`
    : "Приглашает вас как ученика"

// «30 октября» in the device's zone; the year only when it isn't this year's.
export const invitationDate = (invitedAt: string, now: Date = new Date()): string => {
  const d = new Date(invitedAt)
  if (Number.isNaN(d.getTime())) return ""
  const day = `${d.getDate()} ${MONTHS_OF_RU[d.getMonth()]}`
  return d.getFullYear() === now.getFullYear() ? day : `${day} ${d.getFullYear()}`
}

// Secondary line of an invitation card: group (if any) and when it was sent.
export const invitationMeta = (inv: Invitation, now: Date = new Date()): string =>
  [
    inv.groupName ? `Группа «${inv.groupName}»` : null,
    invitationDate(inv.invitedAt, now) || null,
  ]
    .filter(Boolean)
    .join(" · ")

// Home banner title; null when there is nothing to announce.
export const invitationsBannerText = (list: Invitation[]): string | null => {
  if (list.length === 0) return null
  if (list.length === 1) return `Вас пригласили в клуб «${list[0].workspaceName}»`
  return `${list.length} ${pluralRu(list.length, "приглашение", "приглашения", "приглашений")} в клубы`
}

export const acceptedToast = (workspaceName: string): string =>
  `Вы в клубе «${workspaceName}»`

export const declineConfirm = (workspaceName: string) => ({
  title: "Отклонить приглашение?",
  message: `Клуб «${workspaceName}» узнает, что вы отказались. Вступить позже можно будет по коду клуба.`,
})
