import { nextLevelOrder, swapSteps } from "./rank-level-order"

describe("nextLevelOrder", () => {
  it("starts at 0 for an empty ladder", () => {
    expect(nextLevelOrder([])).toBe(0)
  })

  it("uses max + 1, not length, after a gap", () => {
    expect(
      nextLevelOrder([
        { id: "a", order: 0 },
        { id: "c", order: 2 },
      ]),
    ).toBe(3)
  })
})

describe("swapSteps", () => {
  const levels = [
    { id: "a", order: 0 },
    { id: "b", order: 2 },
  ]

  it("parks the moved level on a free order, then swaps", () => {
    expect(swapSteps(levels, 0, 1)).toEqual([
      { levelId: "a", order: 3 },
      { levelId: "b", order: 0 },
      { levelId: "a", order: 2 },
    ])
  })

  it("returns null at the edges", () => {
    expect(swapSteps(levels, 0, -1)).toBeNull()
    expect(swapSteps(levels, 1, 1)).toBeNull()
  })
})
