import {
  accessVerdictFromError,
  OFFLINE_ACCESS_WINDOW_MS,
  OFFLINE_REVALIDATE_INTERVAL_MS,
  offlineAccessDecision,
  offlineAccessExpiresAt,
  shouldRevalidateAccess,
} from "./offline-access"

const T0 = Date.UTC(2026, 10, 1, 12)

describe("offlineAccessDecision", () => {
  it("plays inside the window after the last server check", () => {
    expect(offlineAccessDecision({ lastValidatedAt: T0, now: T0 })).toBe("ok")
    expect(
      offlineAccessDecision({
        lastValidatedAt: T0,
        now: T0 + OFFLINE_ACCESS_WINDOW_MS,
      }),
    ).toBe("ok")
  })

  it("blocks once the window has passed", () => {
    expect(
      offlineAccessDecision({
        lastValidatedAt: T0,
        now: T0 + OFFLINE_ACCESS_WINDOW_MS + 1,
      }),
    ).toBe("expired")
  })

  it("treats a clock wound back past the last check as expired", () => {
    expect(
      offlineAccessDecision({ lastValidatedAt: T0, now: T0 - 24 * 3600_000 }),
    ).toBe("expired")
  })

  it("tolerates small clock drift", () => {
    expect(
      offlineAccessDecision({ lastValidatedAt: T0, now: T0 - 60_000 }),
    ).toBe("ok")
  })

  it("reports when the window closes", () => {
    expect(offlineAccessExpiresAt(T0)).toBe(T0 + OFFLINE_ACCESS_WINDOW_MS)
  })
})

describe("shouldRevalidateAccess", () => {
  it("never asks while offline, even when forced", () => {
    expect(
      shouldRevalidateAccess({
        lastValidatedAt: 0,
        now: T0,
        online: false,
        force: true,
      }),
    ).toBe(false)
  })

  it("always asks when opening the lesson online", () => {
    expect(
      shouldRevalidateAccess({
        lastValidatedAt: T0,
        now: T0,
        online: true,
        force: true,
      }),
    ).toBe(true)
  })

  it("asks from lists only once the interval has passed", () => {
    const base = { lastValidatedAt: T0, online: true, force: false }
    expect(
      shouldRevalidateAccess({ ...base, now: T0 + OFFLINE_REVALIDATE_INTERVAL_MS - 1 }),
    ).toBe(false)
    expect(
      shouldRevalidateAccess({ ...base, now: T0 + OFFLINE_REVALIDATE_INTERVAL_MS }),
    ).toBe(true)
  })
})

describe("accessVerdictFromError", () => {
  const http = (status: number) => ({ response: { status } })

  it.each([403, 404])("reads %i as access denied", (status) => {
    expect(accessVerdictFromError(http(status))).toBe("denied")
  })

  it.each([
    ["a network error", { code: "ERR_NETWORK" }],
    ["a 500", http(500)],
    ["an expired session", http(401)],
    ["a non-object", "boom"],
    ["null", null],
  ])("reads %s as unreachable", (_label, error) => {
    expect(accessVerdictFromError(error)).toBe("unreachable")
  })
})
