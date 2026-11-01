import {
  billingBanner,
  daysUntil,
  formatBytes,
  formatHours,
  isOverPaidTier,
  moduleStateLabel,
  readModuleNotEntitled,
  readSuspended,
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
})
