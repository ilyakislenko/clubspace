import { abonementEnd, accessDiffers } from "./member-access"

// Browser-local days of November 2026.
const at = (day: number, hour = 12) => new Date(2026, 10, day, hour).toISOString()

describe("abonementEnd", () => {
  it("is the latest end among the current abonements, ignoring open-ended ones", () => {
    expect(abonementEnd([])).toBeNull()
    expect(abonementEnd([{ endDate: null }])).toBeNull()
    expect(
      abonementEnd([{ endDate: at(20) }, { endDate: null }, { endDate: at(28) }]),
    ).toBe(at(28))
  })
})

describe("accessDiffers", () => {
  it("hides the access window when it ends the day the abonement does", () => {
    expect(accessDiffers(at(28, 23), at(28, 9))).toBe(false)
    expect(accessDiffers(null, null)).toBe(false)
  })

  it("shows a manual grant, an early close, or unlimited access next to a dated abonement", () => {
    expect(accessDiffers(at(30), at(28))).toBe(true)
    expect(accessDiffers(at(20), at(28))).toBe(true)
    expect(accessDiffers(null, at(28))).toBe(true)
  })

  it("shows a window when no abonement has an end", () => {
    expect(accessDiffers(at(28), null)).toBe(true)
  })
})
