import { buildMomentLink, momentShareText, parseMomentLink } from "./moment-link"

const ID = "4f8a2c1e-0b7d-4e3a-9c55-1d2e3f4a5b6c"

describe("buildMomentLink", () => {
  it("builds a web link under the deploy's origin", () => {
    expect(buildMomentLink("https://app.club.test/", { videoId: ID, startSec: 221.7 })).toBe(
      `https://app.club.test/video/${ID}?startAt=221`,
    )
  })

  it("builds an app-scheme link", () => {
    expect(buildMomentLink("clubspace://", { videoId: ID, startSec: 5 })).toBe(
      `clubspace://video/${ID}?startAt=5`,
    )
  })

  it("adds the loop end of a segment, rounded up", () => {
    expect(
      buildMomentLink("https://app.club.test", { videoId: ID, startSec: 72.4, endSec: 85.2 }),
    ).toBe(`https://app.club.test/video/${ID}?startAt=72&loopEndAt=86`)
  })

  it("drops a loop end that isn't after the start", () => {
    expect(buildMomentLink("clubspace://", { videoId: ID, startSec: 10.2, endSec: 9 })).toBe(
      `clubspace://video/${ID}?startAt=10`,
    )
  })
})

describe("parseMomentLink", () => {
  it("reads back what was built, web and app scheme alike", () => {
    for (const base of ["https://app.club.test", "clubspace://"]) {
      expect(
        parseMomentLink(buildMomentLink(base, { videoId: ID, startSec: 72, endSec: 86 })),
      ).toEqual({ videoId: ID, startAt: 72, loopEndAt: 86 })
    }
  })

  it("takes a plain lesson link without a moment", () => {
    expect(parseMomentLink(`https://app.club.test/video/${ID}`)).toEqual({ videoId: ID })
  })

  it("ignores bad or inconsistent times", () => {
    expect(parseMomentLink(`clubspace://video/${ID}?startAt=-3&loopEndAt=9`)).toEqual({
      videoId: ID,
    })
    expect(parseMomentLink(`clubspace://video/${ID}?startAt=20&loopEndAt=10`)).toEqual({
      videoId: ID,
      startAt: 20,
    })
    expect(parseMomentLink(`clubspace://video/${ID}?startAt=abc#x`)).toEqual({ videoId: ID })
  })

  it("is null for anything that isn't a lesson link", () => {
    expect(parseMomentLink("clubspace://join/ABCD2345")).toBeNull()
    expect(parseMomentLink("https://app.club.test/videos")).toBeNull()
    expect(parseMomentLink("https://app.club.test/my-video/x")).toBeNull()
  })
})

describe("momentShareText", () => {
  const url = "https://x/video/1?startAt=221"

  it("names the lesson, the moment and its label", () => {
    expect(
      momentShareText({ videoTitle: "Узел", startSec: 221, label: "SLX Toe Hold", url }),
    ).toBe(`Узел — 3:41 «SLX Toe Hold»\n${url}`)
  })

  it("shows a segment's range and leaves out an empty label", () => {
    expect(
      momentShareText({ videoTitle: "Узел", startSec: 221, endSec: 245, label: " ", url }),
    ).toBe(`Узел — 3:41–4:05\n${url}`)
  })
})
