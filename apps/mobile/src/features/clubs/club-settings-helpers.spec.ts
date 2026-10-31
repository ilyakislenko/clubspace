import type { WorkspaceSummary } from "../../shared/api/workspaces"
import {
  clubSettingsView,
  leaveConfirm,
  leftToast,
  muteToast,
} from "./club-settings-helpers"

const club = (over: Partial<WorkspaceSummary> = {}): WorkspaceSummary =>
  ({
    workspaceId: "w1",
    key: "bars",
    name: "Барс",
    roleName: "user",
    isOwner: false,
    notificationsMuted: false,
    ...over,
  }) as WorkspaceSummary

describe("clubSettingsView", () => {
  it("shows a member's role, notifications on, and lets them leave", () => {
    expect(clubSettingsView(club())).toEqual({
      name: "Барс",
      roleLabel: "Ученик",
      notificationsOn: true,
      canLeave: true,
    })
  })

  it("turns the switch off for a muted club", () => {
    expect(clubSettingsView(club({ notificationsMuted: true })).notificationsOn).toBe(
      false,
    )
  })

  it("hides leaving from the owner", () => {
    const view = clubSettingsView(club({ isOwner: true, roleName: "admin" }))
    expect(view.canLeave).toBe(false)
    expect(view.roleLabel).toBe("Владелец")
  })

  it("lets a coach leave (the server decides about primary coaches)", () => {
    const view = clubSettingsView(club({ roleName: "coach" }))
    expect(view.canLeave).toBe(true)
    expect(view.roleLabel).toBe("Тренер")
  })
})

describe("messages", () => {
  it("confirms leaving with the club name and the consequences", () => {
    const c = leaveConfirm("Барс")
    expect(c.title).toBe("Покинуть клуб «Барс»?")
    expect(c.message).toBe(
      "Вы потеряете доступ к расписанию, видео и абонементу этого клуба. Вернуться можно по коду клуба.",
    )
    expect(c.confirm).toBe("Покинуть")
    expect(leftToast("Барс")).toBe("Вы покинули клуб «Барс»")
  })

  it("says what muting does", () => {
    expect(muteToast(true)).toContain("только важные")
    expect(muteToast(false)).toBe("Уведомления клуба включены")
  })
})
