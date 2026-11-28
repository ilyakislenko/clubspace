import {
  formatGuideDuration,
  groupGuidesByRole,
  parseGuidesManifest,
  readGuidesBaseUrl,
} from "../src/shared/lib/guides"

const base = "https://media.club.example/clubspace/downloads/guides"

describe("readGuidesBaseUrl", () => {
  it("treats unset and blank as not configured", () => {
    expect(readGuidesBaseUrl({})).toBeNull()
    expect(readGuidesBaseUrl({ GUIDES_BASE_URL: "  " })).toBeNull()
  })

  it("trims the trailing slash", () => {
    expect(readGuidesBaseUrl({ GUIDES_BASE_URL: `${base}/` })).toBe(base)
  })
})

describe("parseGuidesManifest", () => {
  it("resolves file names against the base and keeps absolute URLs", () => {
    expect(
      parseGuidesManifest(
        [
          {
            id: "owner-setup",
            role: "Владельцу",
            title: "Завести клуб",
            file: "owner-setup-20261128.mp4",
            poster: "owner-setup-20261128.jpg",
            durationSec: 74.6,
          },
          {
            id: "coach-attendance",
            role: "Тренеру",
            title: "Отметить посещения",
            file: "https://cdn.example/a.mp4",
          },
        ],
        base,
      ),
    ).toEqual([
      {
        id: "owner-setup",
        role: "Владельцу",
        title: "Завести клуб",
        file: `${base}/owner-setup-20261128.mp4`,
        poster: `${base}/owner-setup-20261128.jpg`,
        durationSec: 75,
      },
      {
        id: "coach-attendance",
        role: "Тренеру",
        title: "Отметить посещения",
        file: "https://cdn.example/a.mp4",
        poster: null,
        durationSec: null,
      },
    ])
  })

  it("drops incomplete, duplicate and non-http entries", () => {
    const ok = { id: "a", role: "Ученику", title: "A", file: "a.mp4" }
    const guides = parseGuidesManifest(
      [
        ok,
        { ...ok, title: "duplicate id" },
        { id: "b", role: "Ученику", file: "b.mp4" },
        { id: "c", role: "Ученику", title: "C", file: "javascript:alert(1)" },
        { id: "d", role: " ", title: "D", file: "d.mp4" },
        null,
        "e.mp4",
      ],
      base,
    )
    expect(guides.map((g) => g.id)).toEqual(["a"])
  })

  it("has no guides for a manifest that is not a list", () => {
    expect(parseGuidesManifest({ guides: [] }, base)).toEqual([])
    expect(parseGuidesManifest(null, base)).toEqual([])
  })
})

describe("groupGuidesByRole", () => {
  it("groups by role in order of first appearance", () => {
    const guides = parseGuidesManifest(
      [
        { id: "1", role: "Владельцу", title: "1", file: "1.mp4" },
        { id: "2", role: "Тренеру", title: "2", file: "2.mp4" },
        { id: "3", role: "Владельцу", title: "3", file: "3.mp4" },
      ],
      base,
    )
    expect(
      groupGuidesByRole(guides).map((g) => [g.role, g.guides.map((x) => x.id)]),
    ).toEqual([
      ["Владельцу", ["1", "3"]],
      ["Тренеру", ["2"]],
    ])
  })
})

describe("formatGuideDuration", () => {
  it("prints minutes and zero-padded seconds", () => {
    expect(formatGuideDuration(75)).toBe("1:15")
    expect(formatGuideDuration(60)).toBe("1:00")
    expect(formatGuideDuration(9)).toBe("0:09")
  })
})
