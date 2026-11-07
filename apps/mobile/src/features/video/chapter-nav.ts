// Pure chapter navigation for the player: which chapter a time falls in and
// where «previous/next chapter» jumps. Chapters are `video.timestamps`, which
// the server returns ordered by `positionSec` ascending — every helper here
// relies on that order.

type ChapterStart = { positionSec: number }

// A seek to a chapter start can read back a hair earlier (frame/millisecond
// rounding), so a time this close before a start already counts as inside it —
// otherwise «next» right after a jump would land on the same chapter again.
export const CHAPTER_EPSILON_SEC = 0.5

// «Previous» restarts the current chapter when more than this far into it,
// otherwise it goes to the previous one (the usual media-player behaviour).
export const PREV_RESTART_SEC = 3

// Index of the chapter playing at `time`, or -1 before the first chapter (or
// when there are none).
export const chapterIndexAt = (
  chapters: ReadonlyArray<ChapterStart>,
  time: number,
): number => {
  let index = -1
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].positionSec <= time + CHAPTER_EPSILON_SEC) index = i
    else break
  }
  return index
}

// Where «previous chapter» seeks: the current chapter's start when more than
// PREV_RESTART_SEC into it, else the start of the last chapter beginning
// strictly earlier (chapters sharing a second would otherwise hold it in
// place), else the very beginning of the video (the lead-in before the first
// chapter).
export const prevChapterTarget = (
  chapters: ReadonlyArray<ChapterStart>,
  time: number,
): number => {
  const index = chapterIndexAt(chapters, time)
  if (index < 0) return 0
  const start = chapters[index].positionSec
  if (time - start > PREV_RESTART_SEC) return start
  for (let i = index - 1; i >= 0; i--) {
    if (chapters[i].positionSec < start) return chapters[i].positionSec
  }
  return 0
}

// Where «next chapter» seeks, or null when the last chapter is playing.
export const nextChapterTarget = (
  chapters: ReadonlyArray<ChapterStart>,
  time: number,
): number | null => {
  const next = chapters[chapterIndexAt(chapters, time) + 1]
  return next ? next.positionSec : null
}
