import {
  draftFromBookmark,
  draftFromChapter,
  draftFromMoment,
  draftFromTechniqueMoment,
} from "./plan-drafts"
import { moveId } from "./plan-order"
import {
  adjacentPlayableIndex,
  type PlanItemLike,
  planStep,
  reachedItemEnd,
  resolvePlanIndex,
} from "./plan-playback"

const item = (
  videoId: string,
  over: Partial<PlanItemLike> = {},
): PlanItemLike => ({
  videoId,
  startSec: 10,
  endSec: 20,
  accessible: true,
  ...over,
})

describe("adjacentPlayableIndex", () => {
  const items = [
    item("a"),
    item("b", { accessible: false }),
    item("c"),
    item("d", { accessible: false }),
  ]

  it("skips items the member can't watch", () => {
    expect(adjacentPlayableIndex(items, 0, 1)).toBe(2)
    expect(adjacentPlayableIndex(items, 2, -1)).toBe(0)
  })

  it("is null past either end", () => {
    expect(adjacentPlayableIndex(items, 2, 1)).toBeNull()
    expect(adjacentPlayableIndex(items, 0, -1)).toBeNull()
  })

  it("finds the first playable item from before the start", () => {
    expect(adjacentPlayableIndex(items, -1, 1)).toBe(0)
    expect(adjacentPlayableIndex([item("x", { accessible: false })], -1, 1)).toBeNull()
  })
})

describe("resolvePlanIndex", () => {
  const items = [item("a"), item("b"), item("a")]

  it("keeps the requested item when it is this lesson", () => {
    expect(resolvePlanIndex(items, 2, "a")).toBe(2)
  })

  it("falls back to the lesson's first item when the plan changed", () => {
    expect(resolvePlanIndex(items, 1, "a")).toBe(0)
    expect(resolvePlanIndex(items, 9, "b")).toBe(1)
    expect(resolvePlanIndex(items, null, "b")).toBe(1)
  })

  it("is null when the lesson left the plan", () => {
    expect(resolvePlanIndex(items, 0, "z")).toBeNull()
  })
})

describe("reachedItemEnd", () => {
  const segment = item("a", { startSec: 10, endSec: 20 })

  it.each([
    [15, false],
    [19.6, false],
    [19.75, true],
    [20, true],
    [21.5, true],
    [22.5, false],
  ])("at %d s → %p", (time, reached) => {
    expect(reachedItemEnd(time, segment)).toBe(reached)
  })

  it("never ends a moment (it plays on to the lesson's end)", () => {
    expect(reachedItemEnd(20, item("a", { endSec: null }))).toBe(false)
  })
})

describe("planStep", () => {
  it("seeks within the lesson on screen", () => {
    expect(planStep(item("a", { startSec: 42 }), "a")).toEqual({
      kind: "seek",
      startSec: 42,
    })
  })

  it("opens another lesson at the item's start", () => {
    expect(planStep(item("b", { startSec: 5 }), "a")).toEqual({
      kind: "open",
      videoId: "b",
      startSec: 5,
    })
  })
})

describe("plan drafts", () => {
  it("copies a segment bookmark with its name and note", () => {
    expect(
      draftFromBookmark("v1", {
        positionSec: 12.7,
        endSec: 30,
        label: " Sweep ",
        note: "  ",
      }),
    ).toEqual({ videoId: "v1", startSec: 12, endSec: 30, title: "Sweep", note: null })
  })

  const chapters = [
    { positionSec: 0, title: "Intro" },
    { positionSec: 65.4, title: "Grips" },
  ]

  it("turns a chapter into the segment up to the next chapter", () => {
    expect(draftFromChapter("v1", chapters, 0)).toMatchObject({
      startSec: 0,
      endSec: 65,
      title: "Intro",
    })
  })

  it("runs the last chapter to the lesson's end, or leaves it a moment", () => {
    expect(draftFromChapter("v1", chapters, 1, 300.9).endSec).toBe(300)
    expect(draftFromChapter("v1", chapters, 1, null).endSec).toBeNull()
    expect(draftFromChapter("v1", chapters, 1, 65.9).endSec).toBeNull()
  })

  it("takes the current moment in whole seconds", () => {
    expect(draftFromMoment("v1", 93.8)).toEqual({
      videoId: "v1",
      startSec: 93,
      endSec: null,
      title: "",
      note: null,
    })
  })

  it("names a technique's moment after the technique", () => {
    expect(draftFromTechniqueMoment("v1", 12, "Кимура (Kimura)")).toEqual({
      videoId: "v1",
      startSec: 12,
      endSec: null,
      title: "Кимура (Kimura)",
      note: null,
    })
  })
})

describe("moveId", () => {
  const ids = ["a", "b", "c"]

  it.each([
    [0, 1, ["b", "a", "c"]],
    [2, -1, ["a", "c", "b"]],
    [0, -1, ["a", "b", "c"]],
    [2, 1, ["a", "b", "c"]],
    [5, -1, ["a", "b", "c"]],
  ])("moves index %i by %i", (index, delta, expected) => {
    expect(moveId(ids, index, delta)).toEqual(expected)
  })

  it("never changes its input", () => {
    moveId(ids, 0, 1)
    expect(ids).toEqual(["a", "b", "c"])
  })
})
