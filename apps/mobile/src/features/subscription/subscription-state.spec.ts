import {
  accessStatus,
  packGuidance,
  subscriptionState,
  toneColor,
} from "./subscription-state"

const NOW = new Date("2026-10-24T10:00:00Z")
const future = "2026-12-24T00:00:00Z"
const soon = "2026-10-27T00:00:00Z"
const past = "2026-10-01T00:00:00Z"

describe("subscriptionState", () => {
  it("none", () => {
    expect(
      subscriptionState({ accessUntil: null, history: [], current: null }, NOW),
    ).toEqual({ text: "Абонемент не оформлен", tone: "muted" })
  })

  it("expired, even with history", () => {
    const s = subscriptionState(
      { accessUntil: past, history: [{}], current: null },
      NOW,
    )
    expect(s.tone).toBe("danger")
    expect(s.text).toMatch(/^Абонемент закончился /)
  })

  it("no current but history and no accessUntil is not «не оформлен»", () => {
    expect(
      subscriptionState({ accessUntil: null, history: [{}], current: null }, NOW)
        .text,
    ).toBe("Нет действующего абонемента")
  })

  it("active time-based shows the end date", () => {
    const s = subscriptionState(
      { accessUntil: future, history: [{}], current: { classesRemaining: null } },
      NOW,
    )
    expect(s.tone).toBe("ok")
    expect(s.text).toMatch(/^Активен · до /)
  })

  it("active pack shows visits left with plural", () => {
    const s = subscriptionState(
      { accessUntil: future, history: [{}], current: { classesRemaining: 3 } },
      NOW,
    )
    expect(s.text).toMatch(/^Осталось 3 занятия · до /)
    expect(s.tone).toBe("ok")
  })

  it("warns at one visit left", () => {
    const s = subscriptionState(
      { accessUntil: null, history: [{}], current: { classesRemaining: 1 } },
      NOW,
    )
    expect(s).toEqual({ text: "Осталось 1 занятие", tone: "warn" })
  })

  it("used-up pack says the app stays available", () => {
    const s = subscriptionState(
      { accessUntil: future, history: [{}], current: { classesRemaining: 0 } },
      NOW,
    )
    expect(s.text).toMatch(/приложение остаётся доступным/)
    expect(s.tone).toBe("warn")
  })

  it("soon-ending time-based is a warning with days", () => {
    const s = subscriptionState(
      { accessUntil: soon, history: [{}], current: { classesRemaining: null } },
      NOW,
    )
    expect(s.tone).toBe("warn")
    expect(s.text).toMatch(/\(3 дн\.\)$/)
  })
})

describe("subscriptionState pack + expiry", () => {
  it("pack ending soon warns with days left", () => {
    const s = subscriptionState(
      { accessUntil: soon, history: [{}], current: { classesRemaining: 5 } },
      NOW,
    )
    expect(s.tone).toBe("warn")
    expect(s.text).toMatch(/^Осталось 5 занятий · до .*\(3 дн\.\)$/)
  })

  it("used-up pack shows when access ends", () => {
    const s = subscriptionState(
      { accessUntil: future, history: [{}], current: { classesRemaining: 0 } },
      NOW,
    )
    expect(s.text).toMatch(/Занятия закончились.* · доступ до /)
  })
})

describe("packGuidance", () => {
  it("only speaks at 0 or 1 visits left", () => {
    expect(packGuidance(null)).toBeNull()
    expect(packGuidance(5)).toBeNull()
    expect(packGuidance(1)?.text).toBe("Осталось 1 занятие")
    expect(packGuidance(0)?.text).toMatch(/Занятия закончились/)
  })
})

describe("accessStatus", () => {
  it("is null without an access date", () => {
    expect(accessStatus(null, NOW)).toBeNull()
    expect(accessStatus(undefined, NOW)).toBeNull()
  })

  it("is ok well before the end", () => {
    expect(accessStatus(future, NOW)?.variant).toBe("ok")
  })

  it("warns in the last two weeks", () => {
    expect(accessStatus(soon, NOW)).toEqual({ variant: "warn", days: 3 })
  })

  it("is expired once the date has passed", () => {
    expect(accessStatus(past, NOW)?.variant).toBe("expired")
  })
})

describe("toneColor", () => {
  const colors = { danger: "d", accent: "a", text: "t", muted: "m" }
  it("maps each tone onto a theme colour", () => {
    expect(toneColor(colors, "danger")).toBe("d")
    expect(toneColor(colors, "warn")).toBe("a")
    expect(toneColor(colors, "ok")).toBe("t")
    expect(toneColor(colors, "muted")).toBe("m")
  })
})
