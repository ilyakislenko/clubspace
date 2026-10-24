import { hasPressFeedback, PRESSED_OPACITY } from "./press-feedback"

describe("hasPressFeedback", () => {
  it("dims an ordinary pressable that has a handler", () => {
    expect(
      hasPressFeedback({ role: "button", disabled: false, hasHandler: true }),
    ).toBe(true)
    expect(PRESSED_OPACITY).toBeLessThan(1)
  })

  it("opts out structural pressables (modal backdrop / sheet)", () => {
    expect(
      hasPressFeedback({ role: "none", disabled: false, hasHandler: true }),
    ).toBe(false)
  })

  it("does not react when disabled or when nothing handles the press", () => {
    expect(
      hasPressFeedback({ role: "button", disabled: true, hasHandler: true }),
    ).toBe(false)
    expect(
      hasPressFeedback({ role: undefined, disabled: false, hasHandler: false }),
    ).toBe(false)
  })
})
