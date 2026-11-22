import type { StudyPlanItemInput } from "../../shared/api/study-plans"

// What «Добавить в план» sends, built from what the member tapped. Times are
// whole seconds (the server keeps integers).

export type PlanItemDraft = Required<StudyPlanItemInput>

/** A bookmark keeps its moment or A–B segment, name and note. */
export const draftFromBookmark = (
  videoId: string,
  bookmark: { positionSec: number; endSec: number | null; label: string; note: string },
): PlanItemDraft => ({
  videoId,
  startSec: Math.floor(bookmark.positionSec),
  endSec: bookmark.endSec,
  title: bookmark.label.trim(),
  note: bookmark.note.trim() || null,
})

/**
 * A chapter becomes the segment up to the next chapter — or to the end of the
 * lesson for the last one (a moment when the length is unknown).
 */
export const draftFromChapter = (
  videoId: string,
  chapters: ReadonlyArray<{ positionSec: number; title: string }>,
  index: number,
  durationSec?: number | null,
): PlanItemDraft => {
  const chapter = chapters[index]
  const startSec = Math.floor(chapter.positionSec)
  const next = chapters[index + 1]?.positionSec ?? durationSec ?? null
  const endSec = next != null && Math.floor(next) > startSec ? Math.floor(next) : null
  return { videoId, startSec, endSec, title: chapter.title.trim(), note: null }
}

/** The moment playing now. */
export const draftFromMoment = (videoId: string, positionSec: number): PlanItemDraft => ({
  videoId,
  startSec: Math.max(0, Math.floor(positionSec)),
  endSec: null,
  title: "",
  note: null,
})

/** A moment where a technique is taught, named after the technique. */
export const draftFromTechniqueMoment = (
  videoId: string,
  atSec: number,
  techniqueName: string,
): PlanItemDraft => ({ ...draftFromMoment(videoId, atSec), title: techniqueName })
