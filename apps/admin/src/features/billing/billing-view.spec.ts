import {
  billingBanner,
  daysUntil,
  declineReasonRu,
  formatBytes,
  formatHours,
  isOverPaidTier,
  moduleAction,
  moduleActionConfirm,
  moduleOutcomeBanner,
  moduleStateLabel,
  parseRefundAmount,
  paymentFailure,
  paymentReturnBanner,
  paymentReturnId,
  paymentStatusLabel,
  paymentSubject,
  readModuleNotEntitled,
  readSuspended,
  refundableAmount,
  retryOutcomeBanner,
  tierRows,
  usagePercent,
  videoOverage,
  type BillingSnapshot,
} from "./billing-view"

const now = new Date("2026-11-10T12:00:00.000Z")
const klub = { code: "CLUB", name: "Клуб", upTo: 100 }
const pro = { code: "PRO", name: "Про", upTo: 200 }
const set = { code: "NETWORK", name: "Сеть", upTo: null }
const base: BillingSnapshot = {
  status: "ACTIVE",
  trialEndsAt: null,
  currentPeriodEnd: null,
  suspendsAt: null,
  activeMembers: 40,
  tier: klub,
  paidTier: klub,
  modules: [{ code: "VIDEO", entitled: true }],
  videoUsage: {
    storageBytes: 5 * 1024 ** 3,
    includedStorageGb: 20,
    viewedSecondsThisMonth: 10 * 3600,
    includedViewHours: 100,
  },
}

describe("billing view", () => {
  it("counts days up to a date", () => {
    expect(daysUntil("2026-11-13T12:00:00.000Z", now)).toBe(3)
    expect(daysUntil("2026-11-10T13:00:00.000Z", now)).toBe(1)
    expect(daysUntil("2026-11-09T12:00:00.000Z", now)).toBe(-1)
  })

  it("formats sizes and hours", () => {
    expect(formatBytes(2 * 1024 ** 3)).toBe("2 ГБ")
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 ГБ")
    expect(formatBytes(300 * 1024 ** 2)).toBe("300 МБ")
    expect(formatBytes(2048)).toBe("2 КБ")
    expect(formatHours(12 * 3600)).toBe("12")
    expect(formatHours(3.5 * 3600)).toBe("3.5")
  })

  it("usage percent caps at 100", () => {
    expect(usagePercent(15, 30)).toBe(50)
    expect(usagePercent(40, 30)).toBe(100)
    expect(usagePercent(0, 0)).toBe(100)
  })

  it("labels a module by where its access comes from", () => {
    expect(moduleStateLabel({ source: "TRIAL", compUntil: null })).toBe("Пробный период")
    expect(moduleStateLabel({ source: "PAID", compUntil: null })).toBe("Подключён")
    expect(
      moduleStateLabel({ source: "COMP", compUntil: "2026-12-05T12:00:00.000Z" }),
    ).toBe("Бесплатно до 05.12.2026")
    expect(moduleStateLabel({ source: "OFF", compUntil: null })).toBe("Отключён")
    expect(moduleStateLabel({ source: "NONE", compUntil: null })).toBe("Не подключён")
    expect(
      moduleStateLabel({
        source: "PAID",
        compUntil: null,
        cancelAt: "2026-12-05T12:00:00.000Z",
      }),
    ).toBe("Подключён до 05.12.2026")
  })

  it("builds the tier table with an open-ended top tier", () => {
    const rows = tierRows(
      [
        { code: "PRO", name: "Про", upTo: 200, priceMonthly: 9990, extraMemberPrice: 0 },
        { code: "BIZ", name: "Бизнес", upTo: 400, priceMonthly: 16990, extraMemberPrice: 0 },
        { code: "NET", name: "Сеть", upTo: null, priceMonthly: 16990, extraMemberPrice: 35 },
      ],
      "RUB",
    )
    expect(rows[0]).toMatchObject({ range: "до 200" })
    expect(rows[0].price).not.toContain("сверх")
    expect(rows[2].range).toBe("400+")
    expect(rows[2].price).toContain("за каждого сверх 400")
  })

  it("nags only in the last week of a trial", () => {
    const trial = { ...base, status: "TRIAL" as const, paidTier: null }
    expect(
      billingBanner({ ...trial, trialEndsAt: "2026-11-30T00:00:00.000Z" }, now),
    ).toBeNull()
    expect(
      billingBanner({ ...trial, trialEndsAt: "2026-11-12T12:00:00.000Z" }, now),
    ).toMatchObject({ tone: "warning", text: expect.stringContaining("через 2 дня") })
    expect(
      billingBanner({ ...trial, trialEndsAt: "2026-11-01T00:00:00.000Z" }, now)?.text,
    ).toContain("закончился")
  })

  it("warns a past-due club and a suspended one; quiet when active", () => {
    expect(
      billingBanner(
        { ...base, status: "PAST_DUE", suspendsAt: "2026-11-17T00:00:00.000Z" },
        now,
      ),
    ).toMatchObject({ tone: "danger", text: expect.stringContaining("будет приостановлен") })
    expect(billingBanner({ ...base, status: "PAST_DUE" }, now)?.tone).toBe("danger")
    expect(billingBanner({ ...base, status: "SUSPENDED" }, now)?.text).toContain(
      "приостановлен",
    )
    expect(billingBanner(base, now)).toBeNull()
  })

  it("tells a club it outgrew the paid tier", () => {
    const grown = { ...base, activeMembers: 112, tier: pro, paidTier: klub }
    expect(isOverPaidTier(grown)).toBe(true)
    expect(isOverPaidTier({ ...base, paidTier: null })).toBe(false)
    expect(isOverPaidTier({ ...base, tier: klub, paidTier: pro })).toBe(false)
    expect(isOverPaidTier({ ...base, tier: set, paidTier: pro })).toBe(true)
    expect(billingBanner(grown, now)).toEqual({
      tone: "warning",
      text: "Активных учеников 112 — больше лимита тарифа «Клуб» (100). Следующее списание — по тарифу «Про».",
    })
    // A missed payment still outranks it.
    expect(billingBanner({ ...grown, status: "PAST_DUE" }, now)?.tone).toBe("danger")
  })

  it("warns when the tier is about to fill up, not on the top tier", () => {
    expect(billingBanner({ ...base, activeMembers: 92 }, now)).toEqual({
      tone: "info",
      text: "До лимита тарифа «Клуб» осталось 8 активных.",
    })
    expect(billingBanner({ ...base, activeMembers: 99 }, now)?.text).toContain(
      "остался 1 активный",
    )
    expect(billingBanner({ ...base, activeMembers: 89 }, now)).toBeNull()
    expect(
      billingBanner({ ...base, activeMembers: 900, tier: set, paidTier: set }, now),
    ).toBeNull()
  })

  it("reports a video allowance overrun only while VIDEO is on", () => {
    const heavy = {
      ...base,
      videoUsage: {
        ...base.videoUsage,
        storageBytes: 23 * 1024 ** 3,
        viewedSecondsThisMonth: 120 * 3600,
      },
    }
    expect(videoOverage(base)).toEqual([])
    expect(videoOverage(heavy)).toEqual([
      "хранилище 23 ГБ из 20 ГБ",
      "просмотры 120 ч из 100 ч в этом месяце",
    ])
    expect(billingBanner(heavy, now)).toMatchObject({
      tone: "warning",
      text: expect.stringContaining("Сверх лимита оплачивается в следующем счёте"),
    })
    expect(
      videoOverage({ ...heavy, modules: [{ code: "VIDEO", entitled: false }] }),
    ).toEqual([])
  })

  it("recognises the suspended-club API error", () => {
    expect(
      readSuspended({
        response: {
          data: {
            code: "WORKSPACE_SUSPENDED",
            message: "Клуб приостановлен",
            metadata: { workspaceName: "Клуб", reason: "INACTIVE" },
          },
        },
      }),
    ).toEqual({ workspaceName: "Клуб", reason: "INACTIVE", message: "Клуб приостановлен" })
    expect(readSuspended({ response: { data: { code: "FORBIDDEN" } } })).toBeNull()
    expect(readSuspended(new Error("x"))).toBeNull()
    expect(readSuspended(null)).toBeNull()
  })

  it("recognises the module-not-entitled API error", () => {
    expect(
      readModuleNotEntitled({
        response: {
          data: {
            code: "MODULE_NOT_ENTITLED",
            message: "Модуль «Онлайн-оплата» не подключён",
            metadata: { module: "ONLINE_PAYMENTS" },
          },
        },
      }),
    ).toEqual({ module: "ONLINE_PAYMENTS", message: "Модуль «Онлайн-оплата» не подключён" })
    expect(readModuleNotEntitled({ response: { data: { code: "FORBIDDEN" } } })).toBeNull()
    expect(readModuleNotEntitled(null)).toBeNull()
  })

  it("translates YooKassa decline reasons, keeps Russian text, falls back", () => {
    expect(declineReasonRu("insufficient_funds")).toBe("на карте недостаточно средств")
    expect(declineReasonRu("card_expired")).toBe("истёк срок действия карты")
    expect(declineReasonRu("permission_revoked")).toContain("карта отвязана")
    expect(declineReasonRu("general_decline")).toBe("банк отклонил платёж")
    expect(declineReasonRu("Платёж не создан")).toBe("Платёж не создан")
    expect(declineReasonRu("something_new")).toBe("платёж отклонён")
    expect(declineReasonRu(null)).toBe("платёж отклонён")
  })

  const payment = {
    kind: "PERIOD" as const,
    initiator: "AUTOPAY" as const,
    module: null,
    status: "SUCCEEDED" as const,
    amount: 2990,
    refundedAmount: 0,
    periodMonths: 1,
    lines: [{ title: "Тариф «Клуб»" }, { title: "Модуль «Видео»" }],
    failureReason: null,
  }

  it("labels payment statuses, incl. partial refunds and free renewals", () => {
    expect(paymentStatusLabel(payment)).toBe("Оплачен")
    expect(paymentStatusLabel({ ...payment, refundedAmount: 500 })).toBe("Частично возвращён")
    expect(paymentStatusLabel({ ...payment, amount: 0 })).toBe("Продлено бесплатно")
    expect(paymentStatusLabel({ ...payment, status: "PENDING" })).toBe("Обрабатывается")
    expect(paymentStatusLabel({ ...payment, status: "CANCELED" })).toBe("Не прошёл")
    expect(paymentStatusLabel({ ...payment, status: "REFUNDED" })).toBe("Возвращён")
  })

  it("describes what a payment was for and why it failed", () => {
    expect(paymentSubject(payment)).toBe("За 1 месяц: Тариф «Клуб», Модуль «Видео»")
    expect(paymentSubject({ ...payment, periodMonths: 12, lines: [] })).toBe("Тариф за год")
    expect(paymentSubject({ ...payment, kind: "MODULE", module: "VIDEO" })).toBe(
      "Модуль «Видео»",
    )
    expect(paymentFailure(payment)).toBeNull()
    expect(
      paymentFailure({ status: "CANCELED", failureReason: "insufficient_funds" }),
    ).toBe("на карте недостаточно средств")
  })

  it("computes what is left to refund and parses the refund amount", () => {
    expect(refundableAmount(payment)).toBe(2990)
    expect(refundableAmount({ ...payment, refundedAmount: 990 })).toBe(2000)
    expect(refundableAmount({ ...payment, amount: 0 })).toBe(0)
    expect(refundableAmount({ ...payment, status: "REFUNDED" })).toBe(0)
    expect(refundableAmount({ ...payment, status: "CANCELED" })).toBe(0)
    expect(parseRefundAmount("", 2000)).toBe("full")
    expect(parseRefundAmount(" 500 ", 2000)).toBe(500)
    expect(parseRefundAmount("2001", 2000)).toBeNull()
    expect(parseRefundAmount("0", 2000)).toBeNull()
    expect(parseRefundAmount("1.5", 2000)).toBeNull()
  })

  it("reads the YooKassa return and words its outcome", () => {
    expect(paymentReturnId("?payment=abc")).toBe("abc")
    expect(paymentReturnId("?x=1")).toBeNull()
    expect(paymentReturnId("")).toBeNull()
    expect(paymentReturnBanner(payment).tone).toBe("success")
    expect(
      paymentReturnBanner({ status: "CANCELED", failureReason: "card_expired" }),
    ).toEqual({ tone: "danger", text: expect.stringContaining("истёк срок действия карты") })
    expect(paymentReturnBanner({ ...payment, status: "PENDING" }).text).toContain(
      "обрабатывается",
    )
    expect(paymentReturnBanner({ ...payment, status: "REFUNDED" }).tone).toBe("info")
  })

  it("derives the club's module action from source, mode and cancelAt", () => {
    expect(moduleAction({ source: "TRIAL", mode: null, cancelAt: null }).action).toBe("connect")
    expect(moduleAction({ source: "NONE", mode: "PAID", cancelAt: null }).action).toBe(
      "connect",
    )
    expect(moduleAction({ source: "NONE", mode: "OFF", cancelAt: null })).toEqual({
      action: null,
      note: "Отключён командой ClubSpace — напишите нам",
    })
    expect(moduleAction({ source: "OFF", mode: "OFF", cancelAt: null }).action).toBeNull()
    expect(moduleAction({ source: "PAID", mode: null, cancelAt: null }).action).toBe(
      "disconnect",
    )
    const restore = moduleAction({
      source: "PAID",
      mode: "PAID",
      cancelAt: "2026-12-05T12:00:00.000Z",
    })
    expect(restore.action).toBe("restore")
    expect(restore.note).toContain("Отключится")
    expect(moduleAction({ source: "COMP", mode: "COMP", cancelAt: null })).toEqual({
      action: null,
      note: null,
    })
    expect(moduleAction({ source: "SELF_HOSTED", mode: null, cancelAt: null }).action).toBeNull()
  })

  it("asks before a paid connection or a disconnection only", () => {
    const ctx = { currency: "RUB", cardLast4: "4242", currentPeriodEnd: null }
    const video = { name: "Видео", connectPrice: 1500 }
    const paid = moduleActionConfirm("connect", video, ctx)
    expect(paid).toContain("за остаток оплаченного периода")
    expect(paid).toContain("•••• 4242")
    expect(moduleActionConfirm("connect", video, { ...ctx, cardLast4: null })).toContain(
      "откроется страница оплаты",
    )
    expect(moduleActionConfirm("connect", { ...video, connectPrice: null }, ctx)).toBeNull()
    expect(moduleActionConfirm("connect", { ...video, connectPrice: 0 }, ctx)).toBeNull()
    expect(moduleActionConfirm("restore", video, ctx)).toBeNull()
    expect(moduleActionConfirm("disconnect", video, ctx)).toContain("отключится сразу")
    expect(
      moduleActionConfirm("disconnect", video, {
        ...ctx,
        currentPeriodEnd: "2026-12-05T12:00:00.000Z",
      }),
    ).toContain("Модуль отключится")
  })

  it("words module outcomes and console retry outcomes", () => {
    expect(moduleOutcomeBanner("CONNECTED", "Видео", null)).toEqual({
      tone: "success",
      text: "Модуль «Видео» подключён.",
    })
    expect(moduleOutcomeBanner("PAYMENT_PENDING", "Видео", null).text).toContain("банк")
    expect(moduleOutcomeBanner("RESTORED", "Видео", null).tone).toBe("success")
    expect(moduleOutcomeBanner("DISCONNECTED", "Видео", null).text).toContain("отключён")
    expect(moduleOutcomeBanner("DISCONNECT_SCHEDULED", "Видео", null).text).toContain(
      "в конце оплаченного периода",
    )
    expect(
      moduleOutcomeBanner("DISCONNECT_SCHEDULED", "Видео", "2026-12-05T12:00:00.000Z").text,
    ).toContain("2026")
    expect(moduleOutcomeBanner("PAYMENT_REQUIRED", "Видео", null).text).toContain("оплате")
    expect(retryOutcomeBanner("CHARGED", null).tone).toBe("success")
    expect(retryOutcomeBanner("EXTENDED_FREE", null).text).toContain("бесплатно")
    expect(retryOutcomeBanner("PENDING", null).tone).toBe("info")
    expect(retryOutcomeBanner("FAILED", "insufficient_funds").text).toBe(
      "Списание не прошло: на карте недостаточно средств.",
    )
    expect(retryOutcomeBanner("SKIPPED", "Период уже продлён").text).toContain(
      "Период уже продлён",
    )
    expect(retryOutcomeBanner("SKIPPED", null).text).toBe("Списание не выполнено.")
  })
})
