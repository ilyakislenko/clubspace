import {
  autopayCardView,
  autopayHeadline,
  autopayTermsText,
  cancelAutopayMessage,
  confirmTermsLabel,
  hasLiveAutopay,
  nextChargeText,
  paidUntilFor,
  type AutopayLike,
} from "./autopay-text"

const rub = (n: string) => `${n}\u00A0₽`

const base: AutopayLike = {
  status: "ACTIVE",
  needsActionReason: null,
  planName: "Безлимит",
  cardLabel: "карта •• 4444",
  termsAmount: 4000,
  currency: "RUB",
  termsDurationDays: 30,
  termsClassCount: null,
  nextCharge: { on: "2026-12-14", amount: 4000, kind: "term" },
  lastError: null,
  lastFailedOn: null,
  nextAttemptOn: null,
  newTerms: null,
  cancelledAt: null,
  cancelSource: null,
  cancelReason: null,
}

describe("autopayTermsText", () => {
  it("reads a term and a pack with plurals", () => {
    expect(
      autopayTermsText({ amount: 4000, durationDays: 30, classCount: null }, "RUB"),
    ).toBe(`${rub("4\u202F000")} за 30 дней`)
    expect(
      autopayTermsText({ amount: 3500, durationDays: 31, classCount: 8 }, "RUB"),
    ).toBe(`${rub("3\u202F500")} за 8 занятий на 31 день`)
    expect(
      autopayTermsText({ amount: 900, durationDays: 2, classCount: 1 }, "RUB"),
    ).toBe(`${rub("900")} за 1 занятие на 2 дня`)
  })
})

describe("nextChargeText", () => {
  it("term: the day and the amount", () => {
    expect(nextChargeText({ on: "2026-12-14", amount: 4000, kind: "term" }, "RUB")).toBe(
      `Следующее списание 14 декабря — ${rub("4\u202F000")}`,
    )
  })

  it("pack: when the classes run out, at the latest on the day", () => {
    expect(
      nextChargeText({ on: "2026-12-14", amount: 4000, kind: "pack" }, "RUB"),
    ).toBe(
      `Когда закончатся занятия, но не позже 14 декабря — ${rub("4\u202F000")}`,
    )
  })
})

describe("autopayHeadline", () => {
  it("names the card when there is a label", () => {
    expect(autopayHeadline(base)).toBe("Автоплатёж включён · карта •• 4444")
    expect(autopayHeadline({ cardLabel: null })).toBe("Автоплатёж включён")
  })
})

describe("autopayCardView", () => {
  it("active: headline, next charge, cancel", () => {
    expect(autopayCardView(base)).toEqual({
      headline: "Автоплатёж включён · карта •• 4444",
      lines: [
        {
          text: `Следующее списание 14 декабря — ${rub("4\u202F000")}`,
          tone: "muted",
        },
      ],
      actions: "cancel",
    })
  })

  it("active with a decline: the warn line with the retry day", () => {
    const view = autopayCardView({
      ...base,
      lastError: "недостаточно средств",
      lastFailedOn: "2026-12-13",
      nextAttemptOn: "2026-12-14",
    })
    expect(view.lines[1]).toEqual({
      text: "Не удалось списать 13 декабря: недостаточно средств. Повторим 14 декабря. Пополните карту или отключите автоплатёж.",
      tone: "warn",
    })
    expect(view.actions).toBe("cancel")
  })

  it("a decline without days drops them", () => {
    expect(
      autopayCardView({ ...base, nextCharge: null, lastError: "отказ банка" })
        .lines,
    ).toEqual([
      {
        text: "Не удалось списать: отказ банка. Пополните карту или отключите автоплатёж.",
        tone: "warn",
      },
    ])
  })

  it("terms changed: was / now, confirm offered", () => {
    const view = autopayCardView({
      ...base,
      status: "NEEDS_ACTION",
      needsActionReason: "TERMS_CHANGED",
      newTerms: { amount: 4500, durationDays: 30, classCount: null },
    })
    expect(view.actions).toBe("confirm")
    expect(view.lines).toEqual([
      {
        text: `Клуб изменил тариф: было ${rub("4\u202F000")} за 30 дней, стало ${rub("4\u202F500")} за 30 дней. Без вашего подтверждения деньги не спишутся.`,
        tone: "warn",
      },
    ])
  })

  it("a pending rise on an active agreement is confirmed the same way", () => {
    expect(
      autopayCardView({
        ...base,
        newTerms: { amount: 4000, durationDays: 30, classCount: 8 },
      }).actions,
    ).toBe("confirm")
  })

  it("stopped: the reason and how to resume", () => {
    const view = autopayCardView({
      ...base,
      status: "NEEDS_ACTION",
      needsActionReason: "CARD_EXPIRED",
      nextCharge: null,
    })
    expect(view.headline).toBeNull()
    expect(view.actions).toBe("cancel")
    expect(view.lines).toEqual([
      {
        text: "Автоплатёж остановлен: срок действия карты истёк. Оплатите абонемент ниже с включённым автопродлением — новая карта сохранится, и автоплатёж продолжится.",
        tone: "danger",
      },
    ])
    expect(
      autopayCardView({
        ...base,
        status: "NEEDS_ACTION",
        needsActionReason: "CHARGE_FAILED",
        lastError: "недостаточно средств",
      }).lines[0].text,
    ).toMatch(/^Автоплатёж остановлен: недостаточно средств\./)
  })

  it("cancelled: the day, and the reason unless the member's own", () => {
    const cancelledAt = new Date(2026, 10, 20, 15, 0).toISOString()
    expect(
      autopayCardView({
        ...base,
        status: "CANCELLED",
        cancelledAt,
        cancelSource: "MEMBER",
        cancelReason: "отключено учеником",
      }),
    ).toEqual({
      headline: null,
      lines: [{ text: "Автоплатёж отключён 20 ноября", tone: "muted" }],
      actions: "none",
    })
    expect(
      autopayCardView({
        ...base,
        status: "CANCELLED",
        cancelledAt,
        cancelSource: "SYSTEM",
        cancelReason: "клуб больше не продлевает этот тариф автоматически",
      }).lines[0].text,
    ).toBe(
      "Автоплатёж отключён 20 ноября — клуб больше не продлевает этот тариф автоматически",
    )
  })
})

describe("confirmTermsLabel / cancelAutopayMessage", () => {
  it("names the agreed price and the paid-until day", () => {
    expect(
      confirmTermsLabel({ amount: 4500, durationDays: 30, classCount: null }, "RUB"),
    ).toBe(`Подтвердить ${rub("4\u202F500")}`)
    expect(cancelAutopayMessage(new Date(2026, 11, 15, 23, 59).toISOString())).toBe(
      "Следующих списаний не будет. Абонемент действует до 15 декабря.",
    )
    expect(cancelAutopayMessage(null)).toBe("Следующих списаний не будет.")
  })
})

describe("paidUntilFor", () => {
  it("takes the latest end of that tariff's abonements", () => {
    const subs = [
      { planId: "p1", endDate: "2026-12-15T20:59:59.999Z" },
      { planId: "p1", endDate: "2027-01-14T20:59:59.999Z" },
      { planId: "p2", endDate: "2027-03-01T00:00:00.000Z" },
      { planId: "p1", endDate: null },
    ]
    expect(paidUntilFor("p1", subs)).toBe("2027-01-14T20:59:59.999Z")
    expect(paidUntilFor("p3", subs)).toBeNull()
    expect(paidUntilFor(null, subs)).toBeNull()
  })
})

describe("hasLiveAutopay", () => {
  it("ignores cancelled agreements", () => {
    expect(hasLiveAutopay([{ status: "CANCELLED" }])).toBe(false)
    expect(
      hasLiveAutopay([{ status: "CANCELLED" }, { status: "NEEDS_ACTION" }]),
    ).toBe(true)
    expect(hasLiveAutopay([])).toBe(false)
  })
})
