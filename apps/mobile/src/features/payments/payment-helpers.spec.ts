import {
  PENDING_TEXT,
  POLL_WINDOW_MS,
  autopayPriceLine,
  checkoutInput,
  discountedPriceText,
  memberDiscountText,
  offerPrice,
  oneOffLine,
  onlinePlanOffer,
  paymentAutopayLine,
  paymentIdFromUrl,
  paymentStatusLine,
  planPriceText,
  planTermsText,
  renewalNote,
  PROMO_QUOTE_AT_ONCE,
  promoQuotePlan,
  saleOptionLabel,
  saleOptionsForPlan,
  shouldKeepPolling,
} from "./payment-helpers"

const rub = (n: string) => `${n}\u00A0₽`

describe("planPriceText", () => {
  it("formats whole roubles with a thousands gap", () => {
    expect(
      planPriceText({
        price: 4500,
        currency: "RUB",
        durationDays: 30,
        classCount: null,
      }),
    ).toBe("4\u202F500\u00A0₽")
  })
})

describe("planTermsText", () => {
  it("shows days and the visit count with plural", () => {
    expect(
      planTermsText({ price: 1, currency: "RUB", durationDays: 30, classCount: 8 }),
    ).toBe("30 дн. · 8 занятий")
    expect(
      planTermsText({ price: 1, currency: "RUB", durationDays: 60, classCount: 2 }),
    ).toBe("60 дн. · 2 занятия")
  })

  it("calls a plan without a visit cap unlimited", () => {
    expect(
      planTermsText({
        price: 1,
        currency: "RUB",
        durationDays: 30,
        classCount: null,
      }),
    ).toBe("30 дн. · безлимит")
  })
})

describe("renewalNote", () => {
  it("names the club-local start day", () => {
    expect(renewalNote("2026-11-05")).toBe("Новый абонемент начнётся 5 ноября")
  })
})

describe("paymentStatusLine", () => {
  it("pending", () => {
    expect(paymentStatusLine({ status: "PENDING", activationError: null })).toEqual({
      text: PENDING_TEXT,
      tone: "muted",
    })
  })

  it("succeeded with the abonement created", () => {
    expect(
      paymentStatusLine({ status: "SUCCEEDED", activationError: null }),
    ).toEqual({ text: "Оплата прошла — абонемент оформлен", tone: "ok" })
  })

  it("an event ticket: paid, or paid but the place is gone", () => {
    expect(
      paymentStatusLine({
        status: "SUCCEEDED",
        activationError: null,
        eventRegistrationId: "reg-1",
      }),
    ).toEqual({ text: "Оплата прошла — билет оплачен", tone: "ok" })
    expect(
      paymentStatusLine({
        status: "SUCCEEDED",
        activationError: "Запись отменена до оплаты",
        eventRegistrationId: "reg-1",
      }).tone,
    ).toBe("warn")
  })

  it("succeeded but the club has to create the abonement by hand", () => {
    expect(
      paymentStatusLine({ status: "SUCCEEDED", activationError: "conflict" }),
    ).toEqual({
      text: "Оплата получена. Абонемент оформит администратор клуба",
      tone: "warn",
    })
  })

  it("canceled", () => {
    expect(
      paymentStatusLine({ status: "CANCELED", activationError: null }),
    ).toEqual({ text: "Оплата не завершена", tone: "danger" })
  })

  it("refunded", () => {
    expect(
      paymentStatusLine({ status: "REFUNDED", activationError: null }).text,
    ).toBe("Платёж возвращён")
  })
})

describe("checkoutInput", () => {
  it("sends no autopay while the switch is off (the default)", () => {
    expect(checkoutInput({ planId: "p1", autopay: null })).toEqual({
      planId: "p1",
    })
    expect(
      checkoutInput({ planId: "p1", promoCode: "OSEN", autopay: null }),
    ).toEqual({ planId: "p1", promoCode: "OSEN" })
  })

  it("sends autopay with the consent version and renewal amount the screen showed", () => {
    expect(
      checkoutInput({
        planId: "p1",
        promoCode: "OSEN",
        autopay: { consentVersion: "2026-11-16", renewalAmount: 4000 },
      }),
    ).toEqual({
      planId: "p1",
      promoCode: "OSEN",
      autopay: true,
      autopayConsentVersion: "2026-11-16",
      autopayRenewalAmount: 4000,
    })
  })
})

describe("autopayPriceLine", () => {
  it("names this payment and each renewal", () => {
    expect(autopayPriceLine(3600, 4000, "RUB")).toBe(
      `Сейчас ${rub("3\u202F600")} · дальше ${rub("4\u202F000")}`,
    )
  })
})

describe("paymentAutopayLine", () => {
  it("is null for a payment without autopay", () => {
    expect(paymentAutopayLine(null, null, "RUB")).toBeNull()
  })

  it("names the next charge of a term and of a pack", () => {
    expect(
      paymentAutopayLine(
        "on",
        { on: "2026-12-14", amount: 4000, kind: "term" },
        "RUB",
      ),
    ).toEqual({
      text: `Автоплатёж включён: следующее списание 14 декабря — ${rub("4\u202F000")}`,
      tone: "ok",
    })
    expect(
      paymentAutopayLine(
        "on",
        { on: "2026-12-14", amount: 4000, kind: "pack" },
        "RUB",
      )?.text,
    ).toBe(
      `Автоплатёж включён: спишем ${rub("4\u202F000")}, когда закончатся занятия, но не позже 14 декабря`,
    )
  })

  it("says autopay is on while the next charge is unknown", () => {
    expect(paymentAutopayLine("on", null, "RUB")).toEqual({
      text: "Автоплатёж включён",
      tone: "ok",
    })
  })

  it("warns when the card wasn't saved", () => {
    expect(paymentAutopayLine("not_saved", null, "RUB")).toEqual({
      text: "Автоплатёж не подключился — платёжная система не сохранила карту. Включить его можно при следующей оплате.",
      tone: "warn",
    })
  })
})

describe("shouldKeepPolling", () => {
  const start = 1_000_000

  it("polls a pending payment inside the window", () => {
    expect(shouldKeepPolling("PENDING", start, start)).toBe(true)
    expect(shouldKeepPolling("PENDING", start, start + POLL_WINDOW_MS - 1)).toBe(
      true,
    )
  })

  it("stops once the window runs out", () => {
    expect(shouldKeepPolling("PENDING", start, start + POLL_WINDOW_MS)).toBe(false)
  })

  it("stops once the payment is settled", () => {
    expect(shouldKeepPolling("SUCCEEDED", start, start)).toBe(false)
    expect(shouldKeepPolling("CANCELED", start, start)).toBe(false)
    expect(shouldKeepPolling("REFUNDED", start, start)).toBe(false)
  })
})

describe("paymentIdFromUrl", () => {
  it("reads the id from the provider's return URL", () => {
    expect(paymentIdFromUrl("https://app.example.com/payment/abc-123")).toBe(
      "abc-123",
    )
    expect(paymentIdFromUrl("https://app.example.com/payment/abc-123/")).toBe(
      "abc-123",
    )
    expect(
      paymentIdFromUrl("https://app.example.com/payment/abc?from=yookassa"),
    ).toBe("abc")
    expect(paymentIdFromUrl("/payment/abc")).toBe("abc")
  })

  it("ignores other paths", () => {
    expect(paymentIdFromUrl("https://app.example.com/")).toBeNull()
    expect(paymentIdFromUrl("https://app.example.com/subscription")).toBeNull()
    expect(paymentIdFromUrl("https://app.example.com/payment/")).toBeNull()
    expect(paymentIdFromUrl("https://app.example.com/x/payment/abc")).toBeNull()
    expect(paymentIdFromUrl("https://app.example.com/payment/a/b")).toBeNull()
  })
})

describe("promoQuotePlan", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`)

  it("quotes every tariff of a club with more than ten, a few at a time", () => {
    const { batches, deferred } = promoQuotePlan(ids(12))
    expect(batches.flat()).toEqual(ids(12))
    expect(batches.map((b) => b.length)).toEqual([5, 5, 2])
    expect(deferred).toBe(false)
  })

  it("quotes the first batch and leaves the rest for their own «Оплатить»", () => {
    const { batches, deferred } = promoQuotePlan(ids(20))
    expect(batches.flat()).toEqual(ids(PROMO_QUOTE_AT_ONCE))
    expect(deferred).toBe(true)
  })

  it("quotes nothing for no tariffs", () => {
    expect(promoQuotePlan([])).toEqual({ batches: [], deferred: false })
  })
})

describe("offerPrice", () => {
  const promo = { name: "Весна", code: "ВЕСНА", isFamily: false, endsOn: "2027-03-31" }

  it("strikes the list price and names the promo code with its end day", () => {
    expect(
      offerPrice({ listPrice: 4000, amount: 3500, currency: "RUB", discount: promo }),
    ).toEqual({
      amount: rub("3\u202F500"),
      listPrice: rub("4\u202F000"),
      note: "Промокод ВЕСНА · до 31 марта",
    })
  })

  it("calls the family discount by its kind, without an end day when open", () => {
    expect(
      offerPrice({
        listPrice: 4000,
        amount: 3600,
        currency: "RUB",
        discount: { name: "Семейная", code: null, isFamily: true, endsOn: null },
      }).note,
    ).toBe("Семейная скидка")
  })

  it("names a staff discount", () => {
    expect(
      offerPrice({
        listPrice: 4000,
        amount: 3400,
        currency: "RUB",
        discount: { name: "Студенческая", code: null, isFamily: false, endsOn: null },
      }).note,
    ).toBe("Скидка «Студенческая»")
  })

  it("shows the plain price without a discount or when nothing is saved", () => {
    expect(
      offerPrice({ listPrice: 4000, amount: 4000, currency: "RUB", discount: null }),
    ).toEqual({ amount: rub("4\u202F000"), listPrice: null, note: null })
    expect(
      offerPrice({ listPrice: 4000, amount: 4000, currency: "RUB", discount: promo }),
    ).toEqual({ amount: rub("4\u202F000"), listPrice: null, note: null })
  })
})

describe("onlinePlanOffer", () => {
  it("reads the options' discount name as the family discount", () => {
    expect(
      onlinePlanOffer({ price: 4000, amount: 3600, currency: "RUB", discountName: "Семейная" }),
    ).toEqual({
      amount: rub("3\u202F600"),
      listPrice: rub("4\u202F000"),
      note: "Семейная скидка",
    })
    expect(
      onlinePlanOffer({ price: 4000, amount: 4000, currency: "RUB", discountName: null }),
    ).toEqual({ amount: rub("4\u202F000"), listPrice: null, note: null })
  })
})

describe("discountedPriceText", () => {
  const base = {
    currency: "RUB",
    discountName: null,
    discountAmount: 0,
    oneOffDiscount: 0,
  }

  it("names a club discount with its size", () => {
    expect(
      discountedPriceText({ ...base, discountName: "Семейная", discountAmount: 400 }),
    ).toBe("скидка «Семейная» −400\u00A0₽")
  })

  it("shows a one-off reduction with who set the price", () => {
    expect(
      discountedPriceText({
        ...base,
        oneOffDiscount: 1000,
        pricedBy: { name: "Петров" },
      }),
    ).toBe(`разовая скидка ${rub("1\u202F000")} · Петров`)
  })

  it("joins both parts; the member's read has no name", () => {
    expect(
      discountedPriceText({
        ...base,
        discountName: "ВЕСНА",
        discountAmount: 500,
        oneOffDiscount: 200,
        pricedBy: { name: "Петров" },
      }),
    ).toBe("скидка «ВЕСНА» −500\u00A0₽ · разовая скидка 200\u00A0₽ · Петров")
    expect(discountedPriceText({ ...base, oneOffDiscount: 200 })).toBe(
      "разовая скидка 200\u00A0₽",
    )
  })

  it("is null for a sale at the price (or sold before prices were kept)", () => {
    expect(discountedPriceText(base)).toBeNull()
    expect(discountedPriceText({ ...base, pricedBy: { name: "Петров" } })).toBeNull()
  })
})

describe("memberDiscountText", () => {
  it("names the club discount only", () => {
    expect(memberDiscountText({ discountName: "Семейная" })).toBe(
      "со скидкой «Семейная»",
    )
    expect(memberDiscountText({ discountName: null })).toBeNull()
  })
})

describe("oneOffLine", () => {
  it("shows how much below the price the typed amount is", () => {
    expect(oneOffLine(4000, 3000, "RUB")).toBe(
      `Разовая скидка −${rub("1\u202F000")} к цене по тарифу — будет видна в «Платежах»`,
    )
  })

  it("stays hidden at or above the price and for an invalid amount", () => {
    expect(oneOffLine(4000, 4000, "RUB")).toBeNull()
    expect(oneOffLine(4000, 4500, "RUB")).toBeNull()
    expect(oneOffLine(4000, null, "RUB")).toBeNull()
  })
})

describe("saleOptionLabel", () => {
  it("reads size and the priced amount", () => {
    expect(
      saleOptionLabel(
        { name: "Семейная", kind: "PERCENT", value: 10 },
        { amount: 3600, currency: "RUB" },
      ),
    ).toBe(`Семейная −10% — ${rub("3\u202F600")}`)
    expect(
      saleOptionLabel(
        { name: "Весна", kind: "FIXED", value: 500 },
        { amount: 3500, currency: "RUB" },
      ),
    ).toBe(`Весна −500\u00A0₽ — ${rub("3\u202F500")}`)
  })
})

describe("saleOptionsForPlan", () => {
  const item = (planId: string, listPrice: number, amount: number) => ({
    planId,
    eventId: null,
    listPrice,
    amount,
    currency: "RUB",
  })
  const options = [
    { discountId: "s", isFamily: false, items: [item("p1", 4000, 3400)] },
    { discountId: "x", isFamily: false, items: [item("p2", 2000, 1800)] },
    {
      discountId: "f",
      isFamily: true,
      items: [item("p1", 4000, 3600), item("p2", 2000, 1800)],
    },
  ]

  it("keeps the options with an item for the tariff, family first", () => {
    expect(
      saleOptionsForPlan(options, "p1").map((o) => [o.option.discountId, o.item.amount]),
    ).toEqual([
      ["f", 3600],
      ["s", 3400],
    ])
    expect(saleOptionsForPlan(options, "p3")).toEqual([])
  })

  it("narrows to items priced from a sale's own list price", () => {
    expect(saleOptionsForPlan(options, "p1", 4000)).toHaveLength(2)
    expect(saleOptionsForPlan(options, "p1", 4500)).toEqual([])
  })
})
