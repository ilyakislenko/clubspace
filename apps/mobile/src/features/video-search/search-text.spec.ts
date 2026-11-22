import { momentKindLabel, splitHighlight } from "./search-text"

describe("splitHighlight", () => {
  it("splits around the hit", () => {
    expect(splitHighlight("…the kimura grip…", { start: 5, length: 6 })).toEqual([
      { text: "…the ", hit: false },
      { text: "kimura", hit: true },
      { text: " grip…", hit: false },
    ])
  })

  it("drops empty parts at either edge", () => {
    expect(splitHighlight("Кимура", { start: 0, length: 6 })).toEqual([
      { text: "Кимура", hit: true },
    ])
  })

  it.each([
    ["no highlight", null],
    ["a range past the end", { start: 4, length: 9 }],
    ["a negative start", { start: -1, length: 2 }],
    ["an empty range", { start: 1, length: 0 }],
  ])("keeps the text whole for %s", (_, highlight) => {
    expect(splitHighlight("Armbar", highlight)).toEqual([{ text: "Armbar", hit: false }])
  })
})

describe("momentKindLabel", () => {
  it("labels chapters and translations, not plain speech", () => {
    expect(momentKindLabel("chapter")).toBe("Глава")
    expect(momentKindLabel("speechRu")).toBe("Перевод")
    expect(momentKindLabel("speech")).toBeNull()
  })
})
