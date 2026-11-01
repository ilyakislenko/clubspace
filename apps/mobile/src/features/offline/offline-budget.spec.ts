import {
  checkStorageBudget,
  estimateTotalBytes,
  formatBytes,
  notEnoughSpaceMessage,
} from "./offline-budget"

const MB = 1024 * 1024
const GB = 1024 * MB

describe("estimateTotalBytes", () => {
  it("extrapolates the sample's bytes per second over the whole lesson, padded", () => {
    // 1.5 MB per 4 s segment → 600 s lesson ≈ 225 MB, plus 15 %.
    const estimate = estimateTotalBytes({
      sampledBytes: 1.5 * MB,
      sampledDurationSec: 4,
      totalDurationSec: 600,
    })
    expect(estimate).toBe(Math.ceil(225 * MB * 1.15))
  })

  it("never projects below what is already stored", () => {
    expect(
      estimateTotalBytes({
        sampledBytes: 10 * MB,
        sampledDurationSec: 600,
        totalDurationSec: 10,
      }),
    ).toBe(10 * MB)
  })

  it("falls back to the sample without durations to scale by", () => {
    expect(
      estimateTotalBytes({
        sampledBytes: 5,
        sampledDurationSec: 0,
        totalDurationSec: 100,
      }),
    ).toBe(5)
  })
})

describe("checkStorageBudget", () => {
  it("passes when the browser reports no quota (the write is the check)", () => {
    expect(
      checkStorageBudget({ quota: undefined, usage: undefined, remainingBytes: GB }),
    ).toEqual({ ok: true, freeBytes: null })
  })

  it("keeps 10 % of a large quota as headroom", () => {
    // 10 GB quota, 1 GB used, 1 GB headroom → 8 GB usable.
    const p = { quota: 10 * GB, usage: GB }
    expect(checkStorageBudget({ ...p, remainingBytes: 8 * GB })).toEqual({
      ok: true,
      freeBytes: 8 * GB,
    })
    expect(checkStorageBudget({ ...p, remainingBytes: 8 * GB + 1 })).toEqual({
      ok: false,
      freeBytes: 8 * GB,
      requiredBytes: 8 * GB + 1,
    })
  })

  it("keeps at least 50 MB on a small quota", () => {
    // 200 MB quota, 100 MB used → 50 MB usable, not 80.
    expect(
      checkStorageBudget({ quota: 200 * MB, usage: 100 * MB, remainingBytes: 60 * MB }),
    ).toEqual({ ok: false, freeBytes: 50 * MB, requiredBytes: 60 * MB })
  })

  it("never reports negative free space", () => {
    const result = checkStorageBudget({ quota: 100 * MB, usage: 99 * MB, remainingBytes: 1 })
    expect(result).toEqual({ ok: false, freeBytes: 0, requiredBytes: 1 })
  })
})

describe("formatting", () => {
  it.each([
    [512, "512 Б"],
    [2048, "2 КБ"],
    [240 * MB, "240.0 МБ"],
    [1.5 * GB, "1.50 ГБ"],
  ])("formats %i bytes as %s", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text)
  })

  it("names both sizes in the refusal", () => {
    expect(notEnoughSpaceMessage({ requiredBytes: 300 * MB, freeBytes: 120 * MB })).toBe(
      "Недостаточно места: для урока нужно ещё ~300.0 МБ, а браузер разрешает занять ~120.0 МБ. Удалите другие загрузки и попробуйте снова.",
    )
  })
})
