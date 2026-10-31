import type { WorkspaceSummary } from "../../shared/api/workspaces"
import { formatRoleName } from "../../shared/role-labels"

export const MUTE_HINT =
  "Если выключить, придут только важные: оплата, доступ, изменения ваших записей"

export type ClubSettingsView = {
  name: string
  roleLabel: string
  // The switch reads «on» while the club is NOT muted.
  notificationsOn: boolean
  // The owner can't leave their own club (the server refuses it too).
  canLeave: boolean
}

export const clubSettingsView = (club: WorkspaceSummary): ClubSettingsView => ({
  name: club.name,
  roleLabel: club.isOwner ? "Владелец" : formatRoleName(club.roleName),
  notificationsOn: !club.notificationsMuted,
  canLeave: !club.isOwner,
})

export const muteToast = (muted: boolean): string =>
  muted
    ? "Уведомления клуба выключены — придут только важные"
    : "Уведомления клуба включены"

export const leaveConfirm = (clubName: string) => ({
  title: `Покинуть клуб «${clubName}»?`,
  message:
    "Вы потеряете доступ к расписанию, видео и абонементу этого клуба. Вернуться можно по коду клуба.",
  confirm: "Покинуть",
})

export const leftToast = (clubName: string): string =>
  `Вы покинули клуб «${clubName}»`
