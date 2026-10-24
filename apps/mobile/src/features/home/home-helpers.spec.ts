import { greetingName, showHomeFallback } from "./home-helpers"

describe("greetingName", () => {
  it("uses the trimmed first name", () => {
    expect(greetingName({ firstname: "  Илья " })).toBe("Илья")
  })

  it("is null when there is no usable name", () => {
    expect(greetingName({ firstname: null })).toBeNull()
    expect(greetingName({ firstname: "   " })).toBeNull()
    expect(greetingName(null)).toBeNull()
  })
})

describe("showHomeFallback", () => {
  const off = {
    groupsOn: false,
    attendanceOn: false,
    subscriptionOn: false,
    hasRecents: false,
  }

  it("shows when nothing else can render", () => {
    expect(showHomeFallback(off)).toBe(true)
  })

  it.each(["groupsOn", "attendanceOn", "subscriptionOn", "hasRecents"] as const)(
    "hides when %s",
    (key) => {
      expect(showHomeFallback({ ...off, [key]: true })).toBe(false)
    },
  )
})
