import type { Invitation } from "../../shared/api/invitations"
import {
  acceptedToast,
  declineConfirm,
  invitationDate,
  invitationMeta,
  invitationRoleLine,
  invitationsBannerText,
} from "./invitation-helpers"

// Built from local wall-clock parts so the spec holds in any TZ.
const localIso = (y: number, m: number, d: number) =>
  new Date(y, m - 1, d, 12).toISOString()
const NOW = new Date(2026, 10, 1, 9)

const inv = (over: Partial<Invitation> = {}): Invitation => ({
  id: "i1",
  workspaceId: "w1",
  workspaceName: "Барс",
  workspaceType: "grappling",
  roleName: "user",
  groupName: null,
  invitedAt: localIso(2026, 10, 30),
  ...over,
})

describe("invitationRoleLine", () => {
  it("names the offered role", () => {
    expect(invitationRoleLine("user")).toBe("Приглашает вас как ученика")
    expect(invitationRoleLine("coach")).toBe("Приглашает вас как тренера")
  })
})

describe("invitationDate", () => {
  it("drops the year within the current one", () => {
    expect(invitationDate(localIso(2026, 10, 30), NOW)).toBe("30 октября")
  })

  it("keeps the year for an older invitation", () => {
    expect(invitationDate(localIso(2025, 12, 5), NOW)).toBe("5 декабря 2025")
  })

  it("is empty for a malformed timestamp", () => {
    expect(invitationDate("nope", NOW)).toBe("")
  })
})

describe("invitationMeta", () => {
  it("joins the group and the date", () => {
    expect(invitationMeta(inv({ groupName: "Дети 7–10" }), NOW)).toBe(
      "Группа «Дети 7–10» · 30 октября",
    )
  })

  it("shows only the date without a group", () => {
    expect(invitationMeta(inv(), NOW)).toBe("30 октября")
  })
})

describe("invitationsBannerText", () => {
  it("is null with no invitations", () => {
    expect(invitationsBannerText([])).toBeNull()
  })

  it("names the club for a single invitation", () => {
    expect(invitationsBannerText([inv()])).toBe("Вас пригласили в клуб «Барс»")
  })

  it("counts several with the right plural", () => {
    expect(invitationsBannerText([inv(), inv({ id: "i2" })])).toBe(
      "2 приглашения в клубы",
    )
    expect(
      invitationsBannerText(
        Array.from({ length: 5 }, (_, i) => inv({ id: `i${i}` })),
      ),
    ).toBe("5 приглашений в клубы")
  })
})

describe("messages", () => {
  it("quotes the club name", () => {
    expect(acceptedToast("Барс")).toBe("Вы в клубе «Барс»")
    expect(declineConfirm("Барс").title).toBe("Отклонить приглашение?")
    expect(declineConfirm("Барс").message).toContain("«Барс»")
  })
})
