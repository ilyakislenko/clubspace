import {
  STACK_PATHS,
  TAB_PATHS,
  formatDocumentTitle,
  webLinking,
} from "./linking"

const ALL_PATHS = { ...STACK_PATHS, ...TAB_PATHS }

describe("route paths", () => {
  it("gives every screen and tab a distinct path", () => {
    const paths = Object.values(ALL_PATHS)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it("puts the home tab at the root", () => {
    expect(TAB_PATHS.Home).toBe("")
  })

  it("keeps the paths members already have bookmarked", () => {
    expect(TAB_PATHS.Profile).toBe("profile")
    expect(TAB_PATHS.Schedule).toBe("schedule")
    expect(STACK_PATHS.CheckIn).toBe("check-in")
  })

  it("moves the course list to /courses, clear of /courses/:courseId", () => {
    expect(TAB_PATHS.Courses).toBe("courses")
    expect(STACK_PATHS.CourseDetail).toBe("courses/:courseId")
  })

  it("uses lowercase, slug-shaped static segments so URLs stay readable", () => {
    for (const [screen, path] of Object.entries(ALL_PATHS)) {
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
    expect(STACK_PATHS.CourseDetail).toContain(":courseId")
    expect(STACK_PATHS.Video).toContain(":videoId")
    expect(STACK_PATHS.SessionAttendance).toContain(":slotId")
    expect(STACK_PATHS.SessionAttendance).toContain(":sessionDate")
  })
})

describe("webLinking", () => {
  const config = webLinking.config as {
    initialRouteName?: string
    screens: Record<string, unknown>
  }

  it("nests the tabs under Main, opening on Home", () => {
    expect(config.initialRouteName).toBe("Main")
    expect(config.screens.Main).toEqual({
      initialRouteName: "Home",
      screens: TAB_PATHS,
    })
  })

  it("maps every pushed screen at the top level", () => {
    for (const [screen, path] of Object.entries(STACK_PATHS)) {
      expect([screen, config.screens[screen]]).toEqual([screen, path])
    }
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
