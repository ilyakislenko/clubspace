import { computeActivity, formatRelativeDays } from "./member-activity"

const daysAgo = (n: number): string =>
  new Date(Date.now() - n * 24 * 3600 * 1000).toISOString()

describe("computeActivity", () => {
  it("returns 'never' when there is no last-watched timestamp", () => {
    expect(computeActivity(null)).toBe("never")
  })
  it("returns 'active' within a week", () => {
    expect(computeActivity(daysAgo(2))).toBe("active")
  })
  it("returns 'slowing' between one and three weeks", () => {
    expect(computeActivity(daysAgo(14))).toBe("slowing")
  })
  it("returns 'inactive' past three weeks", () => {
    expect(computeActivity(daysAgo(30))).toBe("inactive")
  })
})

describe("formatRelativeDays", () => {
  it("renders the recent buckets", () => {
    expect(formatRelativeDays(daysAgo(0))).toBe("сегодня")
    expect(formatRelativeDays(daysAgo(1))).toBe("вчера")
    expect(formatRelativeDays(daysAgo(3))).toBe("3 дн назад")
  })
  it("renders weeks / months / years", () => {
    expect(formatRelativeDays(daysAgo(10))).toBe("1 нед назад")
    expect(formatRelativeDays(daysAgo(60))).toBe("2 мес назад")
    expect(formatRelativeDays(daysAgo(400))).toBe("1 г назад")
  })
})
