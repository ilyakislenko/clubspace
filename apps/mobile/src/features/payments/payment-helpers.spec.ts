import {
  PENDING_TEXT,
  POLL_WINDOW_MS,
  paymentIdFromUrl,
  paymentStatusLine,
  planPriceText,
  planTermsText,
  renewalNote,
  shouldKeepPolling,
} from "./payment-helpers"

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
