import {
  billingBanner,
  daysUntil,
  formatBytes,
  limitLabel,
  readSuspended,
  usagePercent,
} from "./billing-view"

const now = new Date("2026-11-10T12:00:00.000Z")
const base = {
  status: "ACTIVE" as const,
  trialEndsAt: null,
  currentPeriodEnd: null,
  suspendsAt: null,
}

describe("billing view", () => {
  it("counts days up to a date", () => {
    expect(daysUntil("2026-11-13T12:00:00.000Z", now)).toBe(3)
    expect(daysUntil("2026-11-10T13:00:00.000Z", now)).toBe(1)
    expect(daysUntil("2026-11-09T12:00:00.000Z", now)).toBe(-1)
  })

  it("formats sizes", () => {
    expect(formatBytes(2 * 1024 ** 3)).toBe("2 ГБ")
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 ГБ")
    expect(formatBytes(300 * 1024 ** 2)).toBe("300 МБ")
    expect(formatBytes(2048)).toBe("2 КБ")
  })

  it("usage percent caps at 100 and is null when unlimited", () => {
    expect(usagePercent(15, 30)).toBe(50)
    expect(usagePercent(40, 30)).toBe(100)
    expect(usagePercent(0, 0)).toBe(100)
    expect(usagePercent(5, null)).toBeNull()
    expect(limitLabel(null)).toBe("без ограничений")
    expect(limitLabel(2, " ГБ")).toBe("2 ГБ")
  })

  it("nags only in the last week of a trial", () => {
    expect(
      billingBanner(
        { ...base, status: "TRIAL", trialEndsAt: "2026-11-30T00:00:00.000Z" },
        now,
      ),
    ).toBeNull()
    expect(
      billingBanner(
        { ...base, status: "TRIAL", trialEndsAt: "2026-11-12T12:00:00.000Z" },
        now,
      ),
    ).toMatchObject({ tone: "warning", text: expect.stringContaining("через 2 дня") })
    expect(
      billingBanner(
        { ...base, status: "TRIAL", trialEndsAt: "2026-11-01T00:00:00.000Z" },
        now,
      )?.text,
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
})
