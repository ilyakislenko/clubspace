// Geometry of a single-elimination bracket on the division page
// (docs/design/2026-11-27-tournaments.md §7): rounds are columns, a match of
// round r sits centred between the two matches of round r − 1 that feed it.
// Pure: the page passes the matches the API returned.

export type LayoutMatch = { id: string; round: number; position: number }

// Card height and the gap between two first-round cards, in px. The card holds
// two name lines (tablet: ≥ 48 px per tap target together).
export const CARD_HEIGHT = 76
export const CARD_GAP = 16
export const COLUMN_WIDTH = 232
export const COLUMN_GAP = 40

// «Финал», «1/2», «1/4», «1/8»… counted from the last round.
export const roundLabel = (round: number, totalRounds: number): string => {
  const fromEnd = totalRounds - round
  if (fromEnd <= 0) return "Финал"
  return `1/${2 ** fromEnd}`
}

// Rounds of a bracket of `size` slots (a power of two): 2 → 1, 8 → 3.
export const roundCount = (size: number): number => (size <= 1 ? 0 : Math.ceil(Math.log2(size)))

export type PlacedMatch<M extends LayoutMatch> = { match: M; top: number; centre: number }
export type BracketColumn<M extends LayoutMatch> = {
  round: number
  label: string
  left: number
  matches: PlacedMatch<M>[]
}
export type BracketLayout<M extends LayoutMatch> = {
  columns: BracketColumn<M>[]
  width: number
  height: number
  // Connector lines from a match to the one its winner goes to.
  links: { from: { x: number; y: number }; to: { x: number; y: number } }[]
}

export const layoutBracket = <M extends LayoutMatch>(matches: readonly M[]): BracketLayout<M> => {
  const firstRound = matches.filter((m) => m.round === 1).length
  const rounds = Math.max(0, ...matches.map((m) => m.round))
  if (firstRound === 0 || rounds === 0) return { columns: [], width: 0, height: 0, links: [] }
  const pitch = CARD_HEIGHT + CARD_GAP
  // Centre of position p in round r: the mean of its two feeders, i.e. the
  // middle of a block of 2^(r−1) first-round pitches (the first card at 0).
  const centreOf = (round: number, position: number): number => {
    const block = 2 ** (round - 1) * pitch
    return (position - 1) * block + block / 2 - CARD_GAP / 2
  }
  const columns: BracketColumn<M>[] = []
  for (let round = 1; round <= rounds; round++) {
    const left = (round - 1) * (COLUMN_WIDTH + COLUMN_GAP)
    const inRound = matches
      .filter((m) => m.round === round)
      .sort((a, b) => a.position - b.position)
      .map((match) => {
        const centre = centreOf(round, match.position)
        return { match, centre, top: centre - CARD_HEIGHT / 2 }
      })
    columns.push({ round, label: roundLabel(round, rounds), left, matches: inRound })
  }
  const links: BracketLayout<M>["links"] = []
  for (const column of columns.slice(0, -1)) {
    for (const placed of column.matches) {
      const nextPosition = Math.ceil(placed.match.position / 2)
      links.push({
        from: { x: column.left + COLUMN_WIDTH, y: placed.centre },
        to: { x: column.left + COLUMN_WIDTH + COLUMN_GAP, y: centreOf(column.round + 1, nextPosition) },
      })
    }
  }
  return {
    columns,
    width: rounds * COLUMN_WIDTH + (rounds - 1) * COLUMN_GAP,
    height: firstRound * pitch - CARD_GAP,
    links,
  }
}
