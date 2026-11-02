import { blockFit } from "./calendar-helpers"

describe("blockFit", () => {
  it.each([
    // A week day of «Все залы» split four or five ways: no «Д…» stubs.
    [25, "bare"],
    [46, "bare"],
    // Room for «18:30» but not for a title worth reading.
    [60, "start"],
    // A day column of its own.
    [80, "full"],
    [160, "full"],
  ])("%i px → %s", (px, fit) => {
    expect(blockFit(px)).toBe(fit)
  })
})
