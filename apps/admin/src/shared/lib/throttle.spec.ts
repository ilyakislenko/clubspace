import { createThrottle } from "./throttle"

describe("createThrottle", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it("runs the first call at once and collapses the rest into one trailing run", () => {
    const fn = jest.fn()
    const t = createThrottle(fn, 60_000)
    t()
    t()
    t()
    expect(fn).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(59_999)
    expect(fn).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(2)
    jest.advanceTimersByTime(120_000)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("runs at once again after a quiet interval", () => {
    const fn = jest.fn()
    const t = createThrottle(fn, 60_000)
    t()
    jest.advanceTimersByTime(61_000)
    t()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("cancel drops the pending trailing run", () => {
    const fn = jest.fn()
    const t = createThrottle(fn, 60_000)
    t()
    t()
    t.cancel()
    jest.advanceTimersByTime(120_000)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
