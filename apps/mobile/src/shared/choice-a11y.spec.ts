import type { choiceA11y as ChoiceA11y } from "./choice-a11y"

const load = (os: string): typeof ChoiceA11y => {
  let mod: { choiceA11y: typeof ChoiceA11y } | undefined
  jest.isolateModules(() => {
    jest.doMock("react-native", () => ({ Platform: { OS: os } }))
    mod = require("./choice-a11y")
  })
  if (!mod) throw new Error("choice-a11y did not load")
  return mod.choiceA11y
}

describe("choiceA11y", () => {
  it("iOS: a button with the selected trait, never radio/checkbox", () => {
    const choiceA11y = load("ios")
    expect(choiceA11y("radio", true)).toEqual({
      accessibilityRole: "button",
      accessibilityState: { selected: true },
    })
    expect(choiceA11y("checkbox", false, { disabled: true })).toEqual({
      accessibilityRole: "button",
      accessibilityState: { disabled: true, selected: false },
    })
  })

  it.each(["android", "web"])("%s: the real role with checked", (os) => {
    const choiceA11y = load(os)
    expect(choiceA11y("radio", false, { busy: true })).toEqual({
      accessibilityRole: "radio",
      accessibilityState: { busy: true, checked: false },
    })
    expect(choiceA11y("checkbox", true)).toEqual({
      accessibilityRole: "checkbox",
      accessibilityState: { checked: true },
    })
  })
})
