import {
  attentionText,
  autopayHeadline,
  autopayImpact,
  autopayNotes,
  autopayPeople,
  renewalAutopayLine,
  type AutopayView,
} from "./autopay-text"

// Intl writes a narrow no-break space in amounts; compare plain text.
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, " ")

const live = (over: Partial<AutopayView> = {}): AutopayView => ({
  planName: "БЖЖ 12",
  status: "ACTIVE",
  needsActionReason: null,
  cardLabel: "карта •• 4444",
  termsAmount: 4000,
  currency: "RUB",
  nextCharge: { on: "2026-12-14", amount: 4000, kind: "term" },
  lastError: null,
  lastFailedOn: null,
  nextAttemptOn: null,
  newTerms: null,
  cancelledAt: null,
  cancelSource: null,
  cancelReason: null,
  cancelledBy: null,
  ...over,
})

// What a head coach gets: the server strips the money and the card.
const stripped = (over: Partial<AutopayView> = {}): AutopayView =>
  live({ cardLabel: null, termsAmount: null, nextCharge: { on: "2026-12-14", amount: null, kind: "term" }, ...over })

describe("autopayHeadline", () => {
  it("says the next charge with amount and card for a club admin", () => {
    expect(plain(autopayHeadline(live()))).toBe(
      "Автоплатёж «БЖЖ 12» · следующее списание 14 дек. · 4 000 ₽ · карта •• 4444",
    )
  })

  it("leaves out what the server stripped", () => {
    expect(autopayHeadline(stripped())).toBe("Автоплатёж «БЖЖ 12» · следующее списание 14 дек.")
  })

  it("words a class pack by its classes running out", () => {
    expect(
      autopayHeadline(stripped({ nextCharge: { on: "2026-12-14", amount: null, kind: "pack" } })),
    ).toBe("Автоплатёж «БЖЖ 12» · когда закончатся занятия, не позже 14 дек.")
  })

  it("names no next charge once stopped", () => {
    expect(autopayHeadline(stripped({ status: "NEEDS_ACTION", needsActionReason: "CHARGE_FAILED" }))).toBe(
      "Автоплатёж «БЖЖ 12»",
    )
  })
})

describe("autopayNotes", () => {
  it("says nothing more for a healthy agreement", () => {
    expect(autopayNotes(live())).toEqual([])
  })

  it("explains a stop with the provider's reason", () => {
    expect(
      autopayNotes(
        live({ status: "NEEDS_ACTION", needsActionReason: "CHARGE_FAILED", lastError: "недостаточно средств" }),
      ),
    ).toEqual([
      {
        tone: "destructive",
        text: "Автоплатёж остановлен: недостаточно средств. Ученик может оплатить в приложении.",
      },
    ])
    expect(autopayNotes(live({ status: "NEEDS_ACTION", needsActionReason: "CARD_EXPIRED" }))[0].text).toBe(
      "Автоплатёж остановлен: срок действия карты истёк. Ученик может оплатить в приложении.",
    )
  })

  it("waits for the member to accept a new price, the amount for club admins only", () => {
    const changed = { status: "NEEDS_ACTION" as const, needsActionReason: "TERMS_CHANGED" }
    expect(
      autopayNotes(live({ ...changed, newTerms: { amount: 4500, durationDays: 30, classCount: null } })).map(
        (n) => plain(n.text),
      ),
    ).toEqual(["Ждёт подтверждения новой цены 4 500 ₽"])
    expect(
      autopayNotes(stripped({ ...changed, newTerms: { amount: null, durationDays: 30, classCount: null } })),
    ).toEqual([{ tone: "destructive", text: "Ждёт, когда ученик подтвердит новые условия" }])
  })

  it("tells a decline being retried", () => {
    expect(
      autopayNotes(
        live({ lastError: "недостаточно средств", lastFailedOn: "2026-12-13", nextAttemptOn: "2026-12-15" }),
      ),
    ).toEqual([
      { tone: "warning", text: "Не прошло списание 13 дек.: недостаточно средств. Повторим 15 дек." },
    ])
  })

  it("says who switched it off and why", () => {
    const off = { status: "CANCELLED" as const, cancelledAt: "2026-12-01T12:00:00.000Z" }
    expect(autopayNotes(live({ ...off, cancelSource: "MEMBER" }))[0].text).toBe(
      "Автоплатёж «БЖЖ 12» отключён 1 дек. — учеником",
    )
    expect(
      autopayNotes(
        live({ ...off, cancelSource: "STAFF", cancelledBy: { name: "Анна" }, cancelReason: "Попросил по телефону" }),
      )[0].text,
    ).toBe("Автоплатёж «БЖЖ 12» отключён 1 дек. — Анна: Попросил по телефону")
    expect(
      autopayNotes(live({ ...off, cancelSource: "SYSTEM", cancelReason: "участник больше не в клубе" }))[0],
    ).toEqual({
      tone: "muted",
      text: "Автоплатёж «БЖЖ 12» отключён 1 дек. — автоматически: участник больше не в клубе",
    })
  })
})

describe("attentionText", () => {
  it("says when it retries, or that it waits for the member", () => {
    expect(attentionText({ reason: null, lastError: "недостаточно средств", nextAttemptOn: "2026-12-16" })).toEqual({
      reason: "недостаточно средств",
      next: "повтор 16 дек.",
    })
    expect(attentionText({ reason: "TERMS_CHANGED", lastError: null, nextAttemptOn: null })).toEqual({
      reason: "клуб изменил условия тарифа, ученик ещё не подтвердил",
      next: "ждёт ученика",
    })
  })
})

describe("renewalAutopayLine", () => {
  it("shows only for a working agreement", () => {
    expect(renewalAutopayLine({ status: "ACTIVE", nextChargeOn: "2026-12-14" })).toBe(
      "продлится автоплатежом 14 дек.",
    )
    expect(renewalAutopayLine({ status: "NEEDS_ACTION", nextChargeOn: null })).toBeNull()
    expect(renewalAutopayLine(null)).toBeNull()
  })
})

describe("autopayImpact", () => {
  const saved = {
    price: 4000,
    durationDays: 30,
    classCount: null,
    autopayAvailable: true,
    directionIds: ["d1", "d2"],
  }

  it("ends autopay when the tariff stops offering it or changes its directions", () => {
    expect(autopayImpact(saved, { ...saved, autopayAvailable: false })).toBe("off")
    expect(autopayImpact(saved, { ...saved, directionIds: ["d1"] })).toBe("off")
    expect(autopayImpact(saved, { ...saved, directionIds: ["d2", "d1"] })).toBeNull()
  })

  it("asks for consent on a rise or another term or pack size, not on a drop", () => {
    expect(autopayImpact(saved, { ...saved, price: 4500 })).toBe("terms")
    expect(autopayImpact(saved, { ...saved, durationDays: 28 })).toBe("terms")
    expect(autopayImpact(saved, { ...saved, classCount: 12 })).toBe("terms")
    expect(autopayImpact(saved, { ...saved, price: 3500 })).toBeNull()
  })

  it("affects nobody on a tariff without autopay", () => {
    expect(autopayImpact({ ...saved, autopayAvailable: false }, { ...saved, price: 9000 })).toBeNull()
  })
})

describe("autopayPeople", () => {
  it("agrees with «у»", () => {
    expect([1, 3, 5, 21].map(autopayPeople)).toEqual(["1 ученика", "3 учеников", "5 учеников", "21 ученика"])
  })
})
