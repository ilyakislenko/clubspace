// Pure sizing rules for the subtitle line over the player: a cue keeps to at
// most three lines inside the picture, shrinking a step at a time before it
// would cover more of it.

// Font sizes tried in order; the last is the smallest still easy to read.
export const SUBTITLE_FONT_STEPS = [16, 14, 13] as const
export const SUBTITLE_MAX_LINES = 3
// Share of the picture's width a cue may take.
const WIDTH_SHARE = 0.86

/** How wide a cue may get over a picture `pictureWidth` px wide. */
export const subtitleMaxWidth = (pictureWidth: number): number =>
  Math.max(0, Math.round(pictureWidth * WIDTH_SHARE))

/**
 * After a layout pass at `step` produced `lineCount` lines: the next, smaller
 * step to try, or null when the cue fits (or there is no smaller step — the
 * cue is then clamped to SUBTITLE_MAX_LINES).
 */
export const nextSubtitleFontStep = (lineCount: number, step: number): number | null =>
  lineCount > SUBTITLE_MAX_LINES && step < SUBTITLE_FONT_STEPS.length - 1
    ? step + 1
    : null
