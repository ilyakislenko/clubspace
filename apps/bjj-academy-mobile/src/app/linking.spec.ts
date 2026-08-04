import { ROUTE_PATHS, formatDocumentTitle } from "./linking"

describe("ROUTE_PATHS", () => {
  it("gives every screen a distinct path", () => {
    const paths = Object.values(ROUTE_PATHS)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it("puts the course list at the root", () => {
    expect(ROUTE_PATHS.Courses).toBe("")
  })

  it("uses lowercase, slug-shaped static segments so URLs stay readable", () => {
    for (const [screen, path] of Object.entries(ROUTE_PATHS)) {
      if (path === "") continue
      expect([screen, path.startsWith("/")]).toEqual([screen, false])
      // `:params` keep their camelCase — they have to match RootStackParamList.
      const staticSegments = path
        .split("/")
        .filter((segment) => !segment.startsWith(":"))
      for (const segment of staticSegments) {
        expect([screen, segment]).toEqual([screen, segment.toLowerCase()])
        expect(segment).toMatch(/^[a-z0-9-]+$/)
      }
    }
  })

  it("names every path param after a param the screen actually takes", () => {
    // Guards against a rename drifting the URL away from RootStackParamList:
    // React Navigation silently produces `undefined` params for a mismatch.
    expect(ROUTE_PATHS.CourseDetail).toContain(":courseId")
    expect(ROUTE_PATHS.Video).toContain(":videoId")
    expect(ROUTE_PATHS.SessionAttendance).toContain(":slotId")
    expect(ROUTE_PATHS.SessionAttendance).toContain(":sessionDate")
  })
})

describe("formatDocumentTitle", () => {
  it("puts the screen first so truncated tabs stay distinguishable", () => {
    expect(formatDocumentTitle("Профиль", "BJJ Academy")).toBe(
      "Профиль · BJJ Academy",
    )
  })

  it("falls back to the app name rather than an English route name", () => {
    expect(formatDocumentTitle(undefined, "BJJ Academy")).toBe("BJJ Academy")
    expect(formatDocumentTitle("   ", "BJJ Academy")).toBe("BJJ Academy")
  })

  it("does not repeat the app name when the screen already is it", () => {
    expect(formatDocumentTitle("BJJ Academy", "BJJ Academy")).toBe(
      "BJJ Academy",
    )
  })
})
