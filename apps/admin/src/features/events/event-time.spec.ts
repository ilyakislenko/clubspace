import { shiftEndWithStart } from "./event-time"

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d)

describe("shiftEndWithStart", () => {
  it("moves the end by the same days when the start date moves", () => {
    const end = shiftEndWithStart(
      { date: day(2026, 11, 10), time: "19:00" },
      { date: day(2026, 11, 10), time: "20:30" },
      { date: day(2026, 11, 3), time: "19:00" },
    )
    expect(end).toEqual({ date: day(2026, 11, 3), time: "20:30" })
  })

  it("keeps the length when the start time moves, crossing midnight", () => {
    const end = shiftEndWithStart(
      { date: day(2026, 11, 10), time: "19:00" },
      { date: day(2026, 11, 10), time: "20:30" },
      { date: day(2026, 11, 10), time: "23:00" },
    )
    expect(end).toEqual({ date: day(2026, 11, 11), time: "00:30" })
  })

  it("keeps a multi-day event's length across a month boundary", () => {
    const end = shiftEndWithStart(
      { date: day(2026, 11, 10), time: "10:00" },
      { date: day(2026, 11, 12), time: "18:00" },
      { date: day(2026, 11, 30), time: "10:00" },
    )
    expect(end).toEqual({ date: day(2026, 12, 2), time: "18:00" })
  })

  it("does not carry an end that was before the start", () => {
    const end = shiftEndWithStart(
      { date: day(2026, 11, 10), time: "19:00" },
      { date: day(2026, 11, 9), time: "19:00" },
      { date: day(2026, 11, 20), time: "18:00" },
    )
    expect(end).toEqual({ date: day(2026, 11, 20), time: "18:00" })
  })
})
