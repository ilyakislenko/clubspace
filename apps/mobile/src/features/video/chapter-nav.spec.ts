import {
  chapterIndexAt,
  nextChapterTarget,
  prevChapterTarget,
} from "./chapter-nav"

// Chapter 1 starts after a 5 s lead-in.
const chapters = [{ positionSec: 5 }, { positionSec: 60 }, { positionSec: 120 }]

describe("chapterIndexAt", () => {
  it("is -1 without chapters", () => {
    expect(chapterIndexAt([], 42)).toBe(-1)
  })

  it("is -1 in the lead-in before the first chapter", () => {
    expect(chapterIndexAt(chapters, 2)).toBe(-1)
  })

  it("finds the chapter the time falls in", () => {
    expect(chapterIndexAt(chapters, 5)).toBe(0)
    expect(chapterIndexAt(chapters, 59)).toBe(0)
    expect(chapterIndexAt(chapters, 60)).toBe(1)
    expect(chapterIndexAt(chapters, 4000)).toBe(2)
  })

  it("counts a time just short of a start as inside that chapter", () => {
    // A seek to 60 that reads back 59.8.
    expect(chapterIndexAt(chapters, 59.8)).toBe(1)
  })
})

describe("prevChapterTarget", () => {
  it("restarts the current chapter when well into it", () => {
    expect(prevChapterTarget(chapters, 75)).toBe(60)
  })

  it("goes to the previous chapter near the current one's start", () => {
    expect(prevChapterTarget(chapters, 62)).toBe(5)
    expect(prevChapterTarget(chapters, 63)).toBe(5)
  })

  it("goes to the very start from the first chapter's start", () => {
    expect(prevChapterTarget(chapters, 6)).toBe(0)
  })

  it("goes to the very start from the lead-in or without chapters", () => {
    expect(prevChapterTarget(chapters, 3)).toBe(0)
    expect(prevChapterTarget([], 300)).toBe(0)
  })

  it("steps back again right after a jump to a chapter start", () => {
    expect(prevChapterTarget(chapters, 59.8)).toBe(5)
  })

  it("steps past chapters that share a second instead of staying put", () => {
    const shared = [{ positionSec: 5 }, { positionSec: 60 }, { positionSec: 60 }]
    expect(prevChapterTarget(shared, 61)).toBe(5)
    expect(prevChapterTarget([{ positionSec: 0 }, { positionSec: 0 }], 1)).toBe(0)
  })
})

describe("nextChapterTarget", () => {
  it("goes to the following chapter", () => {
    expect(nextChapterTarget(chapters, 0)).toBe(5)
    expect(nextChapterTarget(chapters, 30)).toBe(60)
  })

  it("moves on right after a jump that read back a hair early", () => {
    expect(nextChapterTarget(chapters, 59.8)).toBe(120)
  })

  it("is null in the last chapter or without chapters", () => {
    expect(nextChapterTarget(chapters, 130)).toBeNull()
    expect(nextChapterTarget([], 0)).toBeNull()
  })
})
