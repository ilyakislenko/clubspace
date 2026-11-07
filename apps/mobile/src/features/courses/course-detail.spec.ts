import {
  courseAction,
  courseMetaLine,
  lessonProgress,
  stripCourseTitle,
} from "./course-detail"

describe("stripCourseTitle", () => {
  it("drops the course name and its separator from a lesson title", () => {
    expect(stripCourseTitle("Octopus 2.0 · Vol 1 · часть 1", "Octopus 2.0")).toBe(
      "Vol 1 · часть 1",
    )
  })

  it("accepts dash and colon separators and ignores case", () => {
    expect(stripCourseTitle("octopus 2.0 — Vol 2", "Octopus 2.0")).toBe("Vol 2")
    expect(stripCourseTitle("Octopus 2.0: Vol 3", "Octopus 2.0")).toBe("Vol 3")
  })

  it("keeps a title the course name doesn't start", () => {
    expect(stripCourseTitle("Vol 1 · Octopus 2.0", "Octopus 2.0")).toBe(
      "Vol 1 · Octopus 2.0",
    )
  })

  it("keeps a title where the name runs into a longer word", () => {
    expect(stripCourseTitle("Octopus 2.0s · Vol 1", "Octopus 2.0")).toBe(
      "Octopus 2.0s · Vol 1",
    )
  })

  it("never produces an empty title", () => {
    expect(stripCourseTitle("Octopus 2.0", "Octopus 2.0")).toBe("Octopus 2.0")
    expect(stripCourseTitle("Octopus 2.0 · ", "Octopus 2.0")).toBe(
      "Octopus 2.0 · ",
    )
  })

  it("leaves the title alone for a blank course name", () => {
    expect(stripCourseTitle("· Vol 1", "  ")).toBe("· Vol 1")
  })
})

describe("courseMetaLine", () => {
  it("says the lesson count and how many are watched", () => {
    expect(courseMetaLine({ lessons: 31, watched: 0 })).toBe(
      "31 урок · 0 просмотрено",
    )
    expect(courseMetaLine({ lessons: 3, watched: 1 })).toBe(
      "3 урока · 1 просмотрен",
    )
    expect(courseMetaLine({ lessons: 12, watched: 5 })).toBe(
      "12 уроков · 5 просмотрено",
    )
  })

  it("adds downloads and the offline mark only when true", () => {
    expect(
      courseMetaLine({ lessons: 5, watched: 2, downloaded: 0, offline: false }),
    ).toBe("5 уроков · 2 просмотрено")
    expect(
      courseMetaLine({ lessons: 5, watched: 2, downloaded: 3, offline: true }),
    ).toBe("5 уроков · 2 просмотрено · 3 скачано · офлайн")
  })
})

describe("lessonProgress", () => {
  it("is null for an untouched lesson", () => {
    expect(lessonProgress(undefined, 100)).toBeNull()
    expect(lessonProgress({ position: 0 }, 100)).toBeNull()
  })

  it("counts a completed or 90%-watched lesson as watched", () => {
    expect(lessonProgress({ position: 0, completed: true }, 100)).toEqual({
      status: "watched",
      ratio: 1,
    })
    expect(lessonProgress({ position: 95 }, 100)?.status).toBe("watched")
  })

  it("reports a started lesson's share", () => {
    expect(lessonProgress({ position: 25 }, 100)).toEqual({
      status: "in-progress",
      ratio: 0.25,
    })
  })
})

describe("courseAction", () => {
  const lessons = [
    { id: "a", duration: 300, playable: true },
    { id: "b", duration: 300, playable: true },
    { id: "c", duration: 300, playable: true },
  ]

  it("starts a fresh course at its first lesson", () => {
    expect(courseAction(lessons, {})).toEqual({ videoId: "a", label: "Начать" })
  })

  it("continues the most recently left half-watched lesson at its position", () => {
    expect(
      courseAction(lessons, {
        a: { position: 60, updatedAt: 1 },
        c: { position: 192, updatedAt: 5 },
      }),
    ).toEqual({
      videoId: "c",
      startAt: 192,
      label: "Продолжить: урок 3 · 3:12",
    })
  })

  it("moves on to the first unwatched lesson after watched ones", () => {
    expect(
      courseAction(lessons, { a: { position: 0, completed: true } }),
    ).toEqual({ videoId: "b", label: "Продолжить: урок 2" })
  })

  it("skips lessons that can't be opened", () => {
    expect(
      courseAction(
        [
          { id: "a", duration: 300, playable: false },
          { id: "b", duration: 300, playable: true },
        ],
        { a: { position: 60, updatedAt: 9 } },
      ),
    ).toEqual({ videoId: "b", label: "Начать" })
  })

  it("offers to rewatch a finished course from the start", () => {
    const done = { position: 0, completed: true }
    expect(courseAction(lessons, { a: done, b: done, c: done })).toEqual({
      videoId: "a",
      label: "Смотреть снова",
    })
  })

  it("is null when nothing can be opened", () => {
    expect(
      courseAction([{ id: "a", duration: 300, playable: false }], {}),
    ).toBeNull()
    expect(courseAction([], {})).toBeNull()
  })
})
