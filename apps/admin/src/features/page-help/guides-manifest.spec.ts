import { formatGuideDuration, parseGuidesManifest } from "./guides-manifest"

const BASE = "https://s3.example.com/clubspace/downloads/guides"

describe("parseGuidesManifest", () => {
  it("resolves file and poster against the base", () => {
    const guides = parseGuidesManifest(
      [
        {
          id: "invite",
          role: "owner",
          title: "Как позвать учеников",
          file: "invite-20261128.mp4",
          poster: "invite-20261128.jpg",
          durationSec: 125,
        },
      ],
      BASE,
    )
    expect(guides.get("invite")).toEqual({
      id: "invite",
      title: "Как позвать учеников",
      videoUrl: `${BASE}/invite-20261128.mp4`,
      posterUrl: `${BASE}/invite-20261128.jpg`,
      durationSec: 125,
    })
  })

  it("skips unknown ids, entries without a title or file, and later duplicates", () => {
    const guides = parseGuidesManifest(
      [
        { id: "secret", title: "Не наш", file: "x.mp4" },
        { id: "money", title: "", file: "money.mp4" },
        { id: "attendance", title: "Посещения" },
        { id: "attendance", title: "Посещения", file: "javascript:alert(1)" },
        null,
        "student",
        { id: "student", title: "Приложение", file: "student.mp4" },
        { id: "student", title: "Второй раз", file: "student-2.mp4" },
      ],
      BASE,
    )
    expect([...guides.keys()]).toEqual(["student"])
    expect(guides.get("student")?.title).toBe("Приложение")
  })

  it("keeps a guide without a usable poster or length", () => {
    const guide = parseGuidesManifest(
      [{ id: "federation", title: "Турниры", file: "f.mp4", poster: 7, durationSec: "долго" }],
      BASE,
    ).get("federation")
    expect(guide?.posterUrl).toBeNull()
    expect(guide?.durationSec).toBeNull()
  })

  it("treats anything but an array as no guides", () => {
    expect(parseGuidesManifest({ guides: [] }, BASE).size).toBe(0)
    expect(parseGuidesManifest(null, BASE).size).toBe(0)
    expect(parseGuidesManifest("not json", BASE).size).toBe(0)
  })
})

describe("formatGuideDuration", () => {
  it("prints minutes and padded seconds", () => {
    expect(formatGuideDuration(245)).toBe("4:05")
    expect(formatGuideDuration(59)).toBe("0:59")
  })
})
