import {
  hasPressFeedback,
  isAccessibilityElement,
  PRESSED_OPACITY,
} from "./press-feedback"

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

describe("isAccessibilityElement", () => {
  it("lets a screen reader into a structural pressable's children", () => {
    expect(isAccessibilityElement("none", undefined)).toBe(false)
  })

  it("keeps an ordinary pressable one element", () => {
    expect(isAccessibilityElement("button", undefined)).toBe(true)
    expect(isAccessibilityElement(undefined, undefined)).toBe(true)
  })

  it("follows an explicit choice", () => {
    expect(isAccessibilityElement("none", true)).toBe(true)
    expect(isAccessibilityElement("button", false)).toBe(false)
  })
})
