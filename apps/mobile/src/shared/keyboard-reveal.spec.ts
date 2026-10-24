import { revealScrollOffset } from "./keyboard-reveal"

describe("revealScrollOffset", () => {
  it("is null when the field already clears the viewport bottom by the margin", () => {
    // Field ends at 280 in content, viewport 317 tall, not scrolled.
    expect(revealScrollOffset(280, 317, 0)).toBeNull()
  })

  it("scrolls a field below the fold up to the margin above the bottom", () => {
    // A new bookmark's name ending at 640 in the side panel, which the
    // keyboard shrank to 317.6 dp on an Android 16 tablet in landscape:
    // 640 + 16 - 317.6 = 338.4 → 339.
    expect(revealScrollOffset(640, 317.6, 180)).toBe(339)
  })

  it("never scrolls back up to reveal a field that is already visible", () => {
    expect(revealScrollOffset(400, 317, 200)).toBeNull()
  })

  it("honours a custom margin", () => {
    expect(revealScrollOffset(300, 300, 0, 24)).toBe(24)
  })
})
