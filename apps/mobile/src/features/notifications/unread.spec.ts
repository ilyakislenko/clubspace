import { countUnread, formatBadge } from "./unread"

describe("countUnread", () => {
  it("counts only items not yet seen", () => {
    expect(
      countUnread([{ seen: false }, { seen: true }, { seen: false }]),
    ).toBe(2)
    expect(countUnread([])).toBe(0)
  })
})

describe("formatBadge", () => {
  it("hides the badge for zero", () => {
    expect(formatBadge(0)).toBeNull()
    expect(formatBadge(-1)).toBeNull()
  })

  it("shows the number, capped at 99+", () => {
    expect(formatBadge(1)).toBe("1")
    expect(formatBadge(99)).toBe("99")
    expect(formatBadge(100)).toBe("99+")
  })
})
