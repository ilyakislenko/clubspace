import { vocabularyForWorkspaceType } from "@clubspace/ui-kit/brand"

import {
  abonementShortLine as abonementShortLineIn,
  accessStatus,
  currentAbonements,
  mySubscriptionState as mySubscriptionStateIn,
  soonestEndingId,
  freezeExtendsText,
  freezeLine,
  freezePhase,
  localYmd,
  packGuidance,
  paymentLine,
  periodText as periodTextIn,
  subscriptionState as subscriptionStateIn,
  toneColor,
} from "./subscription-state"

// The academy's words («тренировка»); a dance studio's are checked at the end.
const SPORT = vocabularyForWorkspaceType("GRAPPLING")
const DANCE = vocabularyForWorkspaceType("DANCE")
const subscriptionState = (
  input: Parameters<typeof subscriptionStateIn>[0],
  now?: Date,
) => subscriptionStateIn(input, SPORT, now)
const mySubscriptionState = (
  data: Parameters<typeof mySubscriptionStateIn>[0],
  now?: Date,
) => mySubscriptionStateIn(data, SPORT, now)
const periodText = (s: Parameters<typeof periodTextIn>[0]) => periodTextIn(s, SPORT)
const abonementShortLine = (a: Parameters<typeof abonementShortLineIn>[0]) =>
  abonementShortLineIn(a, SPORT)

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

// Dates are well clear of NOW (2026-10-24) so the device timezone can't flip a phase.
const currentFreeze = { fromDate: "2026-10-20", untilDate: "2026-10-30" }
const upcomingFreeze = { fromDate: "2026-11-01", untilDate: "2026-11-07" }
const pastFreeze = { fromDate: "2026-10-01", untilDate: "2026-10-07" }

describe("subscriptionState with a freeze", () => {
  it("current freeze says «Заморожен по …» as a warning", () => {
    const s = subscriptionState(
      {
        accessUntil: future,
        history: [{}],
        current: { classesRemaining: null },
        freeze: currentFreeze,
      },
      NOW,
    )
    expect(s.text).toMatch(/^Заморожен по 30 октября/)
    expect(s.tone).toBe("warn")
  })

  it("adds the visits left for a pack", () => {
    const base = {
      accessUntil: future,
      history: [{}],
      freeze: currentFreeze,
    }
    expect(
      subscriptionState({ ...base, current: { classesRemaining: 3 } }, NOW).text,
    ).toBe("Заморожен по 30 октября · осталось 3 занятия")
    expect(
      subscriptionState({ ...base, current: { classesRemaining: 0 } }, NOW).text,
    ).toBe("Заморожен по 30 октября · занятий не осталось")
  })

  it("expired still wins over a freeze", () => {
    const s = subscriptionState(
      {
        accessUntil: past,
        history: [{}],
        current: { classesRemaining: null },
        freeze: currentFreeze,
      },
      NOW,
    )
    expect(s.tone).toBe("danger")
  })

  it("an upcoming freeze leaves the state unchanged", () => {
    const input = {
      accessUntil: future,
      history: [{}],
      current: { classesRemaining: null },
    }
    expect(subscriptionState({ ...input, freeze: upcomingFreeze }, NOW)).toEqual(
      subscriptionState(input, NOW),
    )
  })
})

describe("freezeLine", () => {
  it("describes a current freeze", () => {
    expect(freezeLine(currentFreeze, NOW)).toBe(
      "Заморозка с 20 по 30 октября (11 дн.)",
    )
  })

  it("describes an upcoming freeze", () => {
    expect(freezeLine(upcomingFreeze, NOW)).toBe(
      "Заморозка запланирована: с 1 по 7 ноября (7 дн.)",
    )
  })

  it("is null for a past freeze or none", () => {
    expect(freezeLine(pastFreeze, NOW)).toBeNull()
    expect(freezeLine(null, NOW)).toBeNull()
  })
})

describe("freezePhase / localYmd", () => {
  it("compares plain dates against the local day", () => {
    expect(freezePhase(currentFreeze, NOW)).toBe("current")
    expect(freezePhase(upcomingFreeze, NOW)).toBe("upcoming")
    expect(freezePhase(pastFreeze, NOW)).toBe("past")
  })

  it("formats the local calendar day", () => {
    expect(localYmd(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05")
  })
})

describe("freezeExtendsText", () => {
  it("states the extension", () => {
    expect(freezeExtendsText(7)).toBe(
      "Срок абонемента продлён на 7 дн. на время заморозки",
    )
  })
})

describe("subscriptionState waiting for the first visit", () => {
  const base = { accessUntil: future, history: [{}] }
  // Sold on the device's 24 October: the latest start is 7 November.
  const createdAt = new Date(2026, 9, 24, 12).toISOString()
  const pending = { status: "ACTIVE", startDate: null, createdAt }

  it("says it starts at the first visit, no later than the deadline, with no countdown", () => {
    expect(
      subscriptionState(
        { ...base, current: { classesRemaining: null, ...pending } },
        NOW,
      ),
    ).toEqual({
      text: "Начнётся с первой тренировки · не позже 7 ноября",
      tone: "ok",
    })
  })

  it("adds the class count for a pack", () => {
    expect(
      subscriptionState(
        { ...base, current: { classesRemaining: 8, ...pending } },
        NOW,
      ).text,
    ).toBe("Начнётся с первой тренировки · не позже 7 ноября · 8 занятий")
  })

  it("drops the deadline for a cache without createdAt", () => {
    expect(
      subscriptionState(
        {
          ...base,
          current: { classesRemaining: null, status: "ACTIVE", startDate: null },
        },
        NOW,
      ).text,
    ).toBe("Начнётся с первой тренировки")
  })

  it("does not treat an old cache without startDate as pending", () => {
    expect(
      subscriptionState({ ...base, current: { classesRemaining: null } }, NOW)
        .text,
    ).toMatch(/^Активен · до /)
  })

  it("is not «закончился» from a stale window while the server says ACTIVE", () => {
    expect(
      subscriptionState(
        {
          accessUntil: past,
          history: [{}],
          current: { classesRemaining: null, ...pending },
        },
        NOW,
      ).tone,
    ).toBe("ok")
  })

  it("still reports an expired window as expired when it is not ACTIVE", () => {
    expect(
      subscriptionState(
        {
          accessUntil: past,
          history: [{}],
          current: { classesRemaining: null, ...pending, status: "CANCELLED" },
        },
        NOW,
      ).tone,
    ).toBe("danger")
  })
})

describe("periodText", () => {
  it("names the first visit while the abonement has no dates", () => {
    expect(
      periodText({
        startDate: null,
        endDate: null,
        durationDays: 30,
        createdAt: new Date(2026, 9, 24, 12).toISOString(),
      }),
    ).toBe("С первой тренировки (не позже 7 ноября) · 30 дн.")
    expect(periodText({ startDate: null, endDate: null })).toBe(
      "С первой тренировки",
    )
  })

  it("shows start → end once started, and just the start when open-ended", () => {
    expect(
      periodText({
        startDate: "2026-10-24T12:00:00Z",
        endDate: "2026-11-23T12:00:00Z",
      }),
    ).toBe("24 октября 2026 г. → 23 ноября 2026 г.")
    expect(
      periodText({ startDate: "2026-10-24T12:00:00Z", endDate: null }),
    ).toBe("24 октября 2026 г.")
  })
})

describe("paymentLine", () => {
  const base = { amountPaid: 5000, currency: "RUB" }

  it("warns about an unpaid abonement with its agreed price", () => {
    expect(paymentLine({ ...base, isPaid: false, paidAt: null })).toEqual({
      text: "Ожидает оплаты: 5\u202F000\u00A0₽",
      tone: "warn",
    })
  })

  it("shows what was paid and when, muted", () => {
    expect(
      paymentLine({ ...base, isPaid: true, paidAt: "2026-10-22T12:00:00Z" }),
    ).toEqual({
      text: "Оплачено: 5\u202F000\u00A0₽ · 22 октября 2026 г.",
      tone: "muted",
    })
  })

  it("reads an old cache without isPaid as paid, and drops a missing date", () => {
    expect(paymentLine(base)).toEqual({
      text: "Оплачено: 5\u202F000\u00A0₽",
      tone: "muted",
    })
  })

  it("names how it was paid, when that was recorded", () => {
    expect(
      paymentLine({
        ...base,
        isPaid: true,
        paidAt: "2026-10-22T12:00:00Z",
        paymentMethod: "TRANSFER",
      }),
    ).toEqual({
      text: "Оплачено: 5\u202F000\u00A0₽ · Перевод · 22 октября 2026 г.",
      tone: "muted",
    })
  })
})

describe("mySubscriptionState", () => {
  const ab = (over: Record<string, unknown> = {}) => ({
    id: "a1",
    classesRemaining: 5 as number | null,
    status: "ACTIVE",
    startDate: "2026-10-01T00:00:00Z" as string | null,
    endDate: future as string | null,
    freeze: null,
    ...over,
  })

  it("reads an old cache without abonements as nothing current", () => {
    expect(currentAbonements({})).toEqual([])
    expect(
      mySubscriptionState({ accessUntil: null, history: [] }, NOW),
    ).toEqual({ text: "Абонемент не оформлен", tone: "muted" })
  })

  it("is exactly subscriptionState for a single abonement, its freeze included", () => {
    const one = ab({ freeze: { fromDate: "2026-10-20", untilDate: "2026-10-30" } })
    expect(
      mySubscriptionState({ accessUntil: future, history: [], abonements: [one] }, NOW),
    ).toEqual(
      subscriptionState(
        { accessUntil: future, history: [], current: one, freeze: one.freeze },
        NOW,
      ),
    )
  })

  it("counts several and speaks for the access window only", () => {
    const two = [ab(), ab({ id: "a2" })]
    const s = mySubscriptionState({ accessUntil: future, history: [], abonements: two }, NOW)
    expect(s.tone).toBe("ok")
    expect(s.text).toMatch(/^Действуют 2 абонемента · доступ до /)
    const near = mySubscriptionState({ accessUntil: soon, history: [], abonements: two }, NOW)
    expect(near).toMatchObject({ tone: "warn" })
    expect(near.text).toMatch(/\(3 дн\.\)$/)
    expect(
      mySubscriptionState({ accessUntil: null, history: [], abonements: two }, NOW),
    ).toEqual({ text: "Действуют 2 абонемента", tone: "ok" })
    expect(
      mySubscriptionState({ accessUntil: past, history: [], abonements: two }, NOW).tone,
    ).toBe("danger")
  })
})

describe("soonestEndingId", () => {
  it("picks the earliest end, skipping open-ended ones", () => {
    expect(
      soonestEndingId([
        { id: "open", endDate: null },
        { id: "late", endDate: "2026-12-01T00:00:00Z" },
        { id: "early", endDate: "2026-11-01T00:00:00Z" },
      ]),
    ).toBe("early")
    expect(soonestEndingId([{ id: "open", endDate: null }])).toBeNull()
    expect(soonestEndingId([])).toBeNull()
  })
})

describe("abonementShortLine", () => {
  const base = {
    classesRemaining: null,
    classesTotal: null,
    startDate: "2026-10-01T00:00:00Z",
    endDate: null,
  }
  it("shows classes of the pack and the end", () => {
    expect(
      abonementShortLine({ ...base, classesRemaining: 5, classesTotal: 12, endDate: future }),
    ).toMatch(/^5 из 12 занятий · до /)
  })
  it("says when it waits for the first visit", () => {
    expect(abonementShortLine({ ...base, startDate: null })).toBe("С первой тренировки")
  })
  it("falls back to «без ограничения» for an open time-only one", () => {
    expect(abonementShortLine(base)).toBe("без ограничения по времени")
  })
})

describe("first-visit wording in a dance studio", () => {
  const pending = { startDate: null, endDate: null }
  it("starts «с первого занятия» everywhere the academy says «с первой тренировки»", () => {
    expect(periodTextIn(pending, DANCE)).toBe("С первого занятия")
    expect(
      abonementShortLineIn({ ...pending, classesRemaining: null, classesTotal: null }, DANCE),
    ).toBe("С первого занятия")
    expect(
      subscriptionStateIn(
        {
          accessUntil: future,
          history: [],
          current: { classesRemaining: 8, status: "ACTIVE", startDate: null },
        },
        DANCE,
        NOW,
      ).text,
    ).toBe("Начнётся с первого занятия · 8 занятий")
  })
})
