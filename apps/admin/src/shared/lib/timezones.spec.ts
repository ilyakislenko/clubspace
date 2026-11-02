import {
  filterTimezoneOptions,
  formatUtcOffset,
  isValidTimezone,
  TIMEZONE_CITIES,
  timezoneLabel,
  timezoneOffsetMinutes,
  timezoneOptions,
} from "./timezones"

describe("timezones", () => {
  it("lists only zones the runtime knows", () => {
    for (const c of TIMEZONE_CITIES) expect(isValidTimezone(c.zone)).toBe(true)
  })

  it("labels a zone by its city and current offset", () => {
    expect(timezoneLabel("Asia/Tomsk")).toBe("Томск (UTC+7)")
    expect(timezoneLabel("Europe/Moscow")).toBe("Москва (UTC+3)")
    // A zone off the list reads as itself.
    expect(timezoneLabel("Europe/Minsk")).toBe("Europe/Minsk (UTC+3)")
  })

  it("formats offsets, half hours and UTC included", () => {
    expect(formatUtcOffset(420)).toBe("UTC+7")
    expect(formatUtcOffset(330)).toBe("UTC+5:30")
    expect(formatUtcOffset(-60)).toBe("UTC−1")
    expect(formatUtcOffset(0)).toBe("UTC")
    expect(timezoneOffsetMinutes("Asia/Kolkata")).toBe(330)
    expect(timezoneOffsetMinutes("UTC")).toBe(0)
    expect(timezoneOffsetMinutes("Asia/Tomks")).toBeNull()
  })

  it("sorts west to east", () => {
    const offsets = timezoneOptions().map((o) => o.offset ?? 0)
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b))
    expect(timezoneOptions()[0].label).toBe("Калининград (UTC+2)")
  })

  it("finds a city by part of its name, ё-insensitive, by zone or offset", () => {
    const options = timezoneOptions()
    const labels = (q: string) => filterTimezoneOptions(options, q).map((o) => o.label)
    expect(labels("томс")).toEqual(["Томск (UTC+7)"])
    expect(labels("Asia/Tomsk")).toEqual(["Томск (UTC+7)"])
    expect(labels("UTC+7")).toEqual(
      expect.arrayContaining(["Томск (UTC+7)", "Новосибирск (UTC+7)", "Красноярск (UTC+7)"]),
    )
    expect(labels("")).toHaveLength(options.length)
    expect(labels("нет такого")).toEqual([])
  })
})
