import { CARD_GAP, CARD_HEIGHT, COLUMN_GAP, COLUMN_WIDTH, layoutBracket, roundCount, roundLabel } from "./bracket-layout"

const bracket = (size: number) => {
  const matches: { id: string; round: number; position: number }[] = []
  for (let round = 1, n = size / 2; n >= 1; round++, n /= 2) {
    for (let position = 1; position <= n; position++) matches.push({ id: `r${round}p${position}`, round, position })
  }
  return matches
}

describe("round labels", () => {
  it("counts from the final: Финал, 1/2, 1/4, 1/8", () => {
    expect([1, 2, 3, 4].map((r) => roundLabel(r, 4))).toEqual(["1/8", "1/4", "1/2", "Финал"])
    expect(roundLabel(1, 1)).toBe("Финал")
    expect([1, 2].map((r) => roundLabel(r, 2))).toEqual(["1/2", "Финал"])
  })

  it("knows the rounds of a bracket size", () => {
    expect([1, 2, 4, 8, 16, 64].map(roundCount)).toEqual([0, 1, 2, 3, 4, 6])
  })
})

describe("layoutBracket", () => {
  it("puts rounds in columns and centres a match between its two feeders", () => {
    const layout = layoutBracket(bracket(8))
    expect(layout.columns.map((c) => c.label)).toEqual(["1/4", "1/2", "Финал"])
    expect(layout.columns.map((c) => c.left)).toEqual([0, COLUMN_WIDTH + COLUMN_GAP, 2 * (COLUMN_WIDTH + COLUMN_GAP)])
    const [quarter, semi, final] = layout.columns
    expect(semi.matches[0].centre).toBe((quarter.matches[0].centre + quarter.matches[1].centre) / 2)
    expect(semi.matches[1].centre).toBe((quarter.matches[2].centre + quarter.matches[3].centre) / 2)
    expect(final.matches[0].centre).toBe((semi.matches[0].centre + semi.matches[1].centre) / 2)
    expect(quarter.matches[0].top).toBe(0)
    expect(layout.height).toBe(4 * (CARD_HEIGHT + CARD_GAP) - CARD_GAP)
    expect(layout.width).toBe(3 * COLUMN_WIDTH + 2 * COLUMN_GAP)
  })

  it("orders a column by position whatever the input order, byes included as round-1 cards", () => {
    const shuffled = [...bracket(4)].reverse()
    const layout = layoutBracket(shuffled)
    expect(layout.columns[0].matches.map((m) => m.match.id)).toEqual(["r1p1", "r1p2"])
  })

  it("links every match but the final to the match its winner goes to", () => {
    const layout = layoutBracket(bracket(4))
    expect(layout.links).toHaveLength(2)
    const final = layout.columns[1].matches[0]
    expect(layout.links.every((l) => l.to.y === final.centre && l.to.x === COLUMN_WIDTH + COLUMN_GAP)).toBe(true)
  })

  it("is empty for a division without matches (one athlete)", () => {
    expect(layoutBracket([])).toEqual({ columns: [], width: 0, height: 0, links: [] })
  })
})
