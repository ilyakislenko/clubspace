import { formatYmd } from "./format-ymd"

describe("formatYmd", () => {
  it("renders a plain date in Russian without shifting the day", () => {
    const out = formatYmd("2026-11-05")
    expect(out).toContain("5")
    expect(out).toContain("нояб")
    expect(out).toContain("2026")
  })

  it("returns non-date input unchanged", () => {
    expect(formatYmd("скоро")).toBe("скоро")
  })
})
