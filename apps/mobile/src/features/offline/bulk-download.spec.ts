import {
  bulkResultMessage,
  combinedProgress,
  downloadedSummary,
  localCount,
  missingTargets,
  phaseFraction,
  phaseLabel,
  uniqueTargets,
} from "./bulk-download"

const t = (videoId: string, thumbnailUrl: string | null = null) => ({
  videoId,
  thumbnailUrl,
})

describe("uniqueTargets", () => {
  it("keeps each lesson once, at its first place", () => {
    expect(
      uniqueTargets([t("a", "1"), t("b"), t("a", "2"), t("c"), t("b")]),
    ).toEqual([t("a", "1"), t("b"), t("c")])
  })

  it("returns an empty list for no lessons", () => {
    expect(uniqueTargets([])).toEqual([])
  })
})

describe("missingTargets / localCount", () => {
  const targets = [t("a"), t("b"), t("c")]

  it("skips lessons already on the device", () => {
    const local = new Set(["b", "z"])
    expect(missingTargets(targets, local)).toEqual([t("a"), t("c")])
    expect(localCount(targets, local)).toBe(1)
  })

  it("counts only the given lessons, not every local copy", () => {
    const local = new Set(["a", "b", "c", "x", "y"])
    expect(missingTargets(targets, local)).toEqual([])
    expect(localCount(targets, local)).toBe(3)
  })
})

describe("phaseLabel / phaseFraction", () => {
  it("shows the video's percent and its fraction", () => {
    const p = { phase: "video" as const, done: 25, total: 100 }
    expect(phaseLabel(p)).toBe("25%")
    expect(phaseFraction(p)).toBe(0.25)
  })

  it("says «видео» at 0 while the size is unknown", () => {
    const p = { phase: "video" as const, done: 300, total: 0 }
    expect(phaseLabel(p)).toBe("видео")
    expect(phaseFraction(p)).toBe(0)
  })

  it("counts the cover and the end as a finished lesson", () => {
    expect(phaseLabel({ phase: "thumbnail" })).toBe("превью")
    expect(phaseFraction({ phase: "thumbnail" })).toBe(1)
    expect(phaseLabel({ phase: "done" })).toBe("готово")
    expect(phaseFraction({ phase: "done" })).toBe(1)
  })

  it("never reports past a whole lesson", () => {
    expect(phaseFraction({ phase: "video", done: 150, total: 100 })).toBe(1)
  })
})

describe("combinedProgress", () => {
  it("adds the running lesson to the finished ones", () => {
    expect(
      combinedProgress({ currentIndex: 1, totalVideos: 4, videoFraction: 0.5 }),
    ).toBe(0.375)
  })

  it("is 0 at the start and 1 when the last lesson ends", () => {
    expect(
      combinedProgress({ currentIndex: 0, totalVideos: 3, videoFraction: 0 }),
    ).toBe(0)
    expect(
      combinedProgress({ currentIndex: 2, totalVideos: 3, videoFraction: 1 }),
    ).toBe(1)
  })

  it("stays within 0..1 for odd input", () => {
    expect(
      combinedProgress({ currentIndex: 0, totalVideos: 0, videoFraction: 1 }),
    ).toBe(0)
    expect(
      combinedProgress({ currentIndex: 3, totalVideos: 3, videoFraction: 2 }),
    ).toBe(1)
  })
})

describe("messages", () => {
  it("summarizes what is already on the device", () => {
    expect(downloadedSummary(3, 8)).toBe("Скачано 3 из 8")
  })

  it("reports a finished run, with the first failure's reason", () => {
    expect(bulkResultMessage({ downloaded: 4, skipped: 0, reason: null })).toBe(
      "Скачано: 4, пропущено: 0",
    )
    expect(
      bulkResultMessage({ downloaded: 2, skipped: 1, reason: "Недостаточно места" }),
    ).toBe("Скачано: 2, пропущено: 1. Недостаточно места")
  })
})
