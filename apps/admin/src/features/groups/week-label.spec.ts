import { weekLabel } from "./week-label"

describe("weekLabel", () => {
  it("lists days sharing a time together, in day order", () => {
    expect(
      weekLabel([
        { dayOfWeek: 6, startTime: "11:00" },
        { dayOfWeek: 3, startTime: "19:00" },
        { dayOfWeek: 1, startTime: "19:00" },
      ]),
    ).toBe("Пн, Ср 19:00 · Сб 11:00")
  })

  it("keeps two times of one day apart", () => {
    expect(
      weekLabel([
        { dayOfWeek: 2, startTime: "20:30" },
        { dayOfWeek: 2, startTime: "07:00" },
      ]),
    ).toBe("Вт 07:00 · Вт 20:30")
  })

  it("is empty for a group without weekly classes", () => {
    expect(weekLabel([])).toBe("")
  })
})
