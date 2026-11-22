import { pluralRu } from "../../shared/format-ru"
import { formatPosition } from "../video/format-position"

// The pure rules of the course screen: a lesson's watch state, the one line
// of course facts, the primary «Продолжить/Начать» action and lesson titles
// without the course name they repeat.

// Same threshold as playback-progress: 90% watched counts as watched.
const WATCHED_RATIO = 0.9

/** A lesson's stored playback entry (playback-progress). */
export type PlaybackEntry = {
  position: number
  updatedAt?: number
  completed?: boolean
}

export type LessonProgress = {
  status: "watched" | "in-progress"
  /** 0..1; 1 when watched. */
  ratio: number
}

/** Watched / in progress / untouched (null) — as the course summary counts it. */
export const lessonProgress = (
  entry: PlaybackEntry | undefined,
  duration?: number | null,
): LessonProgress | null => {
  if (!entry) return null
  if (entry.completed) return { status: "watched", ratio: 1 }
  if (entry.position <= 0) return null
  const ratio =
    duration && duration > 0 ? Math.min(entry.position / duration, 1) : 0
  if (ratio >= WATCHED_RATIO) return { status: "watched", ratio: 1 }
  return { status: "in-progress", ratio }
}

/** «31 урок · 0 просмотрено», plus «· 5 скачано» / «· офлайн» when true. */
export const courseMetaLine = (p: {
  lessons: number
  watched: number
  downloaded?: number
  offline?: boolean
}): string => {
  const parts = [
    `${p.lessons} ${pluralRu(p.lessons, "урок", "урока", "уроков")}`,
    `${p.watched} ${pluralRu(p.watched, "просмотрен", "просмотрено", "просмотрено")}`,
  ]
  const downloaded = p.downloaded ?? 0
  if (downloaded > 0) {
    parts.push(
      `${downloaded} ${pluralRu(downloaded, "скачан", "скачано", "скачано")}`,
    )
  }
  if (p.offline) parts.push("офлайн")
  return parts.join(" · ")
}

// A separator between the course name and the rest of a lesson title:
// «Octopus 2.0 · Vol 1», «Octopus 2.0 — Vol 1», «Octopus 2.0: Vol 1». A hyphen
// or a dot counts only with a space after it: «Octopus-guard entries» is one
// word, not «Octopus» + «guard entries».
const SEPARATOR = /^\s*(?:[·•|:/–—,]|[-.]+(?=\s))+\s*/

/**
 * A lesson title without the course name it starts with — inside the course
 * the name is already on screen. Stripped only when the name is followed by a
 * separator and something remains; otherwise the title is returned as is.
 */
export const stripCourseTitle = (
  lessonTitle: string,
  courseTitle: string,
): string => {
  const prefix = courseTitle.trim()
  if (!prefix) return lessonTitle
  const title = lessonTitle.trimStart()
  if (
    title.slice(0, prefix.length).toLocaleLowerCase() !==
    prefix.toLocaleLowerCase()
  ) {
    return lessonTitle
  }
  const rest = title.slice(prefix.length)
  const separator = SEPARATOR.exec(rest)
  if (!separator) return lessonTitle
  const stripped = rest.slice(separator[0].length).trim()
  return stripped ? stripped : lessonTitle
}

export type CourseActionLesson = {
  id: string
  duration?: number | null
  /** Open now: not locked and ready (or downloaded). */
  playable: boolean
}

/** The course's primary action: which lesson to open, where, and its label. */
export type CourseAction = {
  videoId: string
  /** Seconds to start at — the saved position when continuing a lesson. */
  startAt?: number
  label: string
}

/**
 * «Продолжить: урок 4 · 3:12» — the lesson last left half-watched; otherwise
 * the first unwatched lesson («Начать» on a fresh course, «Продолжить: урок N»
 * after some are watched); «Смотреть снова» when all are watched. Null when
 * nothing can be opened.
 */
export const courseAction = (
  lessons: readonly CourseActionLesson[],
  progress: Readonly<Record<string, PlaybackEntry | undefined>>,
): CourseAction | null => {
  const states = lessons.map((l) => lessonProgress(progress[l.id], l.duration))

  let resume: { index: number; position: number; updatedAt: number } | null =
    null
  for (let index = 0; index < lessons.length; index++) {
    const lesson = lessons[index]
    const entry = progress[lesson.id]
    if (!lesson.playable || !entry) continue
    if (states[index]?.status !== "in-progress") continue
    const updatedAt = entry.updatedAt ?? 0
    if (!resume || updatedAt > resume.updatedAt) {
      resume = { index, position: entry.position, updatedAt }
    }
  }
  if (resume) {
    const { index, position } = resume
    return {
      videoId: lessons[index].id,
      startAt: position,
      label: `Продолжить: урок ${index + 1} · ${formatPosition(position)}`,
    }
  }

  const next = lessons.findIndex(
    (l, i) => l.playable && states[i]?.status !== "watched",
  )
  if (next >= 0) {
    const anyWatched = states.some((s) => s?.status === "watched")
    return {
      videoId: lessons[next].id,
      label: anyWatched ? `Продолжить: урок ${next + 1}` : "Начать",
    }
  }

  const allWatched =
    lessons.length > 0 && states.every((s) => s?.status === "watched")
  const first = lessons.findIndex((l) => l.playable)
  if (allWatched && first >= 0) {
    return { videoId: lessons[first].id, label: "Смотреть снова" }
  }
  return null
}
