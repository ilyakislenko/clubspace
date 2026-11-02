import {
  clubAccessibilityLabel,
  clubEmoji,
  clubRoleLabel,
  clubStatusLabel,
  clubSubtitle,
  sortClubs,
  unreadBadgeText,
  unreadElsewhere,
  type ClubRowData,
} from "./club-switcher-helpers"

const club = (over: Partial<ClubRowData> = {}): ClubRowData => ({
  workspaceId: "w1",
  name: "Альфа",
  type: "grappling",
  roleName: "user",
  isOwner: false,
  accessExpired: false,
  notificationsMuted: false,
  unreadNotifications: 0,
  ...over,
})

describe("sortClubs", () => {
  it("puts clubs with live access first, then sorts by name", () => {
    const list = [
      club({ workspaceId: "c", name: "Вега" }),
      club({ workspaceId: "x", name: "Альфа", accessExpired: true }),
      club({ workspaceId: "b", name: "Бета" }),
    ]
    expect(sortClubs(list).map((c) => c.workspaceId)).toEqual(["b", "c", "x"])
  })

  it("does not mutate the input", () => {
    const list = [club({ workspaceId: "b", name: "Б" }), club({ name: "А" })]
    sortClubs(list)
    expect(list[0].workspaceId).toBe("b")
  })
})

describe("labels", () => {
  it("names the owner and translates member roles", () => {
    expect(clubRoleLabel(club({ isOwner: true, roleName: "admin" }))).toBe(
      "Владелец",
    )
    expect(clubRoleLabel(club({ roleName: "coach" }))).toBe("Тренер")
    expect(clubRoleLabel(club({ roleName: "user" }))).toBe("Ученик")
  })

  it("names a staff role in each club's own words", () => {
    expect(clubRoleLabel(club({ roleName: "coach", type: "DANCE" }))).toBe("Педагог")
    expect(clubRoleLabel(club({ roleName: "head_coach", type: "YOGA" }))).toBe(
      "Главный преподаватель",
    )
  })

  it("flags an expired access only", () => {
    expect(clubStatusLabel(club())).toBeNull()
    expect(clubStatusLabel(club({ accessExpired: true }))).toBe("доступ истёк")
  })

  it("joins role and status into the subtitle", () => {
    expect(clubSubtitle(club({ roleName: "coach" }))).toBe("Тренер")
    expect(clubSubtitle(club({ accessExpired: true }))).toBe(
      "Ученик · доступ истёк",
    )
  })

  it("maps the club type to its brand emoji, generic when unknown", () => {
    expect(clubEmoji("grappling")).toBe("🥋")
    expect(clubEmoji("YOGA")).toBe("🧘")
    expect(clubEmoji("DANCE")).toBe("💃")
    expect(clubEmoji("chess")).toBe("🎬")
    expect(clubEmoji(null)).toBe("🎬")
  })

  it("reads the whole row for a screen reader", () => {
    expect(
      clubAccessibilityLabel(
        club({ notificationsMuted: true, unreadNotifications: 3 }),
        true,
      ),
    ).toBe(
      "Клуб Альфа, Ученик, уведомления выключены, непрочитанных: 3, текущий",
    )
    expect(clubAccessibilityLabel(club(), false)).toBe("Клуб Альфа, Ученик")
  })
})

describe("unreadBadgeText", () => {
  it("hides the badge for zero, negative or missing counts", () => {
    expect(unreadBadgeText(0)).toBeNull()
    expect(unreadBadgeText(-2)).toBeNull()
    expect(unreadBadgeText(undefined)).toBeNull()
    expect(unreadBadgeText(null)).toBeNull()
    expect(unreadBadgeText(Number.NaN)).toBeNull()
  })

  it("caps at 99+", () => {
    expect(unreadBadgeText(1)).toBe("1")
    expect(unreadBadgeText(99)).toBe("99")
    expect(unreadBadgeText(100)).toBe("99+")
  })
})

describe("unreadElsewhere", () => {
  it("sums unread in every club but the current one", () => {
    const list = [
      club({ workspaceId: "a", unreadNotifications: 5 }),
      club({ workspaceId: "b", unreadNotifications: 2 }),
      club({ workspaceId: "c", unreadNotifications: 4 }),
    ]
    expect(unreadElsewhere(list, "a")).toBe(6)
    expect(unreadElsewhere(list, null)).toBe(11)
  })

  it("ignores a list cached before the counter existed", () => {
    const legacy = [{ workspaceId: "a" } as ClubRowData]
    expect(unreadElsewhere(legacy, "b")).toBe(0)
  })
})
