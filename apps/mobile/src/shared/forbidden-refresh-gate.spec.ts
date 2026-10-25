import { createForbiddenRefreshGate } from "./forbidden-refresh-gate"

describe("createForbiddenRefreshGate", () => {
  it("runs the first refresh", async () => {
    const gate = createForbiddenRefreshGate(30_000, () => 1_000)
    const refresh = jest.fn().mockResolvedValue(undefined)
    expect(await gate(refresh)).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("ignores a second 403 while one refresh is in flight", async () => {
    let t = 0
    const gate = createForbiddenRefreshGate(30_000, () => t)
    let release: () => void = () => undefined
    const slow = jest.fn(
      () => new Promise<void>((resolve) => (release = resolve)),
    )
    const first = gate(slow)
    t = 100_000 // well past the window — still ignored, the first is running
    const second = jest.fn().mockResolvedValue(undefined)
    expect(await gate(second)).toBe(false)
    expect(second).not.toHaveBeenCalled()
    release()
    await first
  })

  it("ignores a 403 within 30 s of the last refresh, allows one after", async () => {
    let t = 0
    const gate = createForbiddenRefreshGate(30_000, () => t)
    const refresh = jest.fn().mockResolvedValue(undefined)
    await gate(refresh)
    t = 29_999
    expect(await gate(refresh)).toBe(false)
    t = 30_000
    expect(await gate(refresh)).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it("lets the next one through after a refresh throws, once the window passes", async () => {
    let t = 0
    const gate = createForbiddenRefreshGate(30_000, () => t)
    await expect(gate(() => Promise.reject(new Error("x")))).rejects.toThrow()
    t = 31_000
    const refresh = jest.fn().mockResolvedValue(undefined)
    expect(await gate(refresh)).toBe(true)
  })
})
