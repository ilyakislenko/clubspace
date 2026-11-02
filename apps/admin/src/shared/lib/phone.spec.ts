import { formatPhone } from "./phone"

describe("formatPhone", () => {
  it.each([
    ["+79001817439", "+7 900 181-74-39"],
    // Kazakhstan shares +7 and the same grouping.
    ["+77012345678", "+7 701 234-56-78"],
    // Russian numbers kept without the plus.
    ["89001817439", "+7 900 181-74-39"],
    ["7 (900) 181-74-39", "+7 900 181-74-39"],
    // Already grouped.
    ["+7 900 181-74-39", "+7 900 181-74-39"],
  ])("masks %s", (stored, shown) => {
    expect(formatPhone(stored)).toBe(shown)
  })

  it.each([
    // Foreign.
    "+375291234567",
    "+4915112345678",
    // «+8 9…» is not a Russian number with a stray plus — don't guess.
    "+89001817439",
    // Too short / too long for the mask.
    "+7900181743",
    "890018174390",
    // Not a phone.
    "abc",
    "8 900 181-74-39 доб. 12",
    "",
  ])("shows %p as stored", (stored) => {
    expect(formatPhone(stored)).toBe(stored)
  })
})
