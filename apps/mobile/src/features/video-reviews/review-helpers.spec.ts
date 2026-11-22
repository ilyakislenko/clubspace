import { vocabularyForWorkspaceType } from "@clubspace/ui-kit/brand"

import {
  ACTIVE_COMMENT_SEC,
  activeCommentId,
  clubReviewsCacheKey,
  isPlayable,
  MAX_CLIP_BYTES,
  MAX_CLIP_DURATION_SEC,
  myReviewsCacheKey,
  pickedClipProblem,
  reviewCacheKey,
  reviewStatusLabel,
  titleFromFileName,
  uploadPercent,
} from "./review-helpers"

describe("reviewStatusLabel", () => {
  it("names every status, waiting in the club's own words", () => {
    const academy = vocabularyForWorkspaceType("GRAPPLING")
    expect(reviewStatusLabel("open", academy)).toBe(`ждёт ${academy.coach.gen}`)
    expect(
      (["uploading", "processing", "failed", "answered", "closed"] as const).map((s) =>
        reviewStatusLabel(s, academy),
      ),
    ).toEqual(["загружается", "обработка", "ошибка", "есть ответ", "закрыт"])
  })

  it("speaks a studio's word there", () => {
    const studio = vocabularyForWorkspaceType("DANCE")
    expect(reviewStatusLabel("open", studio)).toBe(`ждёт ${studio.coach.gen}`)
  })
})

describe("isPlayable", () => {
  it("is true once the clip is transcoded", () => {
    expect(["open", "answered", "closed"].every((s) => isPlayable(s as never))).toBe(true)
    expect(["uploading", "processing", "failed"].some((s) => isPlayable(s as never))).toBe(
      false,
    )
  })
})

describe("pickedClipProblem", () => {
  const ok = { fileSize: 1000, duration: 60_000, mimeType: "video/mp4" }

  it("accepts a short video", () => {
    expect(pickedClipProblem(ok)).toBeNull()
    // Some galleries report no type or length: the server re-checks.
    expect(pickedClipProblem({ fileSize: 1000 })).toBeNull()
  })

  it.each([
    ["an image", { ...ok, mimeType: "image/jpeg" }, "видеофайл"],
    ["an unknown size", { ...ok, fileSize: undefined }, "размер"],
    ["a file over the limit", { ...ok, fileSize: MAX_CLIP_BYTES + 1 }, "500 МБ"],
    [
      "a video over 10 minutes",
      { ...ok, duration: (MAX_CLIP_DURATION_SEC + 1) * 1000 },
      "10 минут",
    ],
  ])("refuses %s", (_, clip, words) => {
    expect(pickedClipProblem(clip)).toContain(words)
  })
})

describe("uploadPercent", () => {
  it.each([
    [0, 0, 0],
    [50, 200, 25],
    [199, 200, 99],
    [300, 200, 100],
    [-5, 200, 0],
  ])("%i of %i → %i %", (sent, total, pct) => {
    expect(uploadPercent(sent, total)).toBe(pct)
  })
})

describe("activeCommentId", () => {
  const comments = [
    { id: "a", atSec: 10, endSec: null },
    { id: "b", atSec: 12, endSec: null },
    { id: "seg", atSec: 30, endSec: 50 },
  ]

  it.each([
    [5, null],
    [10, "a"],
    [12.5, "b"],
    [12 + ACTIVE_COMMENT_SEC + 0.1, null],
    [45, "seg"],
    [51, null],
  ])("at %d s → %p", (t, id) => {
    expect(activeCommentId(comments, t)).toBe(id)
  })
})

describe("titleFromFileName", () => {
  it("drops the extension and trims", () => {
    expect(titleFromFileName("IMG_1234.MOV")).toBe("IMG_1234")
    expect(titleFromFileName(" sparring round 2.mp4 ")).toBe("sparring round 2")
    expect(titleFromFileName(null)).toBe("")
  })
})

describe("cache keys", () => {
  it("keeps every review resource under one invalidation prefix", () => {
    expect(myReviewsCacheKey("w")).toBe("video-reviews:w:mine")
    expect(clubReviewsCacheKey("w")).toBe("video-reviews:w:club")
    expect(reviewCacheKey("w", "r")).toBe("video-reviews:w:r")
  })
})
