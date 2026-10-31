import {
  clubTypeLabel,
  dayLabel,
  groupSlotLines,
  isSafeHttpUrl,
  slotTimeRange,
  telHref,
} from "../src/features/public-club/club-format"

describe("club-format", () => {
  it("labels club types, with a neutral fallback", () => {
    expect(clubTypeLabel("YOGA")).toBe("Йога")
    expect(clubTypeLabel("SOMETHING_NEW")).toBe("Спортивный клуб")
  })

  it("names ISO weekdays", () => {
    expect(dayLabel(1)).toBe("Пн")
    expect(dayLabel(7)).toBe("Вс")
  })

  it("computes the end time, wrapping past midnight", () => {
    expect(slotTimeRange("19:00", 90)).toBe("19:00–20:30")
    expect(slotTimeRange("23:30", 60)).toBe("23:30–00:30")
  })

  it("folds same-time slots of a group into one line", () => {
    expect(
      groupSlotLines([
        { dayOfWeek: 3, startTime: "19:00", durationMin: 90 },
        { dayOfWeek: 6, startTime: "11:00", durationMin: 60 },
        { dayOfWeek: 1, startTime: "19:00", durationMin: 90 },
      ]),
    ).toEqual(["Пн, Ср · 19:00–20:30", "Сб · 11:00–12:00"])
  })

  it("builds a tel: link from a stored phone", () => {
    expect(telHref("+7 952 884-94-20")).toBe("tel:+79528849420")
  })

  it("accepts only http(s) links", () => {
    expect(isSafeHttpUrl("https://club.example")).toBe(true)
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false)
    expect(isSafeHttpUrl("not a url")).toBe(false)
  })
})
