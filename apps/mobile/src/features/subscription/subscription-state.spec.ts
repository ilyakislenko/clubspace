import { packGuidance, subscriptionState } from "./subscription-state"

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

describe("packGuidance", () => {
  it("only speaks at 0 or 1 visits left", () => {
    expect(packGuidance(null)).toBeNull()
    expect(packGuidance(5)).toBeNull()
    expect(packGuidance(1)?.text).toBe("Осталось 1 занятие")
    expect(packGuidance(0)?.text).toMatch(/Занятия закончились/)
  })
})
