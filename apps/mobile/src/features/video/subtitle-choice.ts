// The member's subtitle choice, kept across lessons: a language (with the
// track's label, so «Русский (авто)» and a coach's «Русский» stay apart) or
// Off. Pure, so the matching is unit-tested.

export type SubtitleChoice =
  | { kind: "off" }
  | { kind: "track"; language: string; label: string }

type Track = { id: string; language: string; label: string; isDefault: boolean }

/** The choice a picked track (null = Off) stands for. */
export const choiceFromTrack = (track: Track | null): SubtitleChoice =>
  track
    ? { kind: "track", language: track.language, label: track.label }
    : { kind: "off" }

/**
 * The track a lesson opens with: with no choice yet, the coach's default (or
 * the first track); Off stays off; a chosen language picks the track with the
 * same label, else any track in that language (its default first). A lesson
 * without that language falls back to its default.
 */
export const pickSubtitleTrack = <T extends Track>(
  tracks: readonly T[],
  choice: SubtitleChoice | null,
): T | null => {
  if (tracks.length === 0) return null
  const fallback = tracks.find((t) => t.isDefault) ?? tracks[0]
  if (!choice) return fallback
  if (choice.kind === "off") return null
  const sameLanguage = tracks.filter((t) => t.language === choice.language)
  return (
    sameLanguage.find((t) => t.label === choice.label) ??
    sameLanguage.find((t) => t.isDefault) ??
    sameLanguage[0] ??
    fallback
  )
}

/** A stored value as a choice (null = never chosen, or unreadable). */
export const parseSubtitleChoice = (value: unknown): SubtitleChoice | null => {
  if (typeof value !== "object" || value === null || !("kind" in value)) return null
  if (value.kind === "off") return { kind: "off" }
  if (
    value.kind === "track" &&
    "language" in value &&
    typeof value.language === "string" &&
    "label" in value &&
    typeof value.label === "string"
  ) {
    return { kind: "track", language: value.language, label: value.label }
  }
  return null
}

// The worker names its automatic tracks «English (авто)», «Русский (авто)».
const AUTO_SUFFIX = /\s*\((авто|auto)\)\s*$/i

/**
 * The subtitle menu: «Выкл», then each track by its language — «Русский
 * (авто)» reads «Русский». The suffix stays only where dropping it would
 * make two tracks look the same.
 */
export const subtitleMenuOptions = (
  tracks: ReadonlyArray<{ id: string; label: string }>,
): { id: string | null; label: string }[] => {
  const plain = tracks.map((t) => t.label.replace(AUTO_SUFFIX, ""))
  return [
    { id: null, label: "Выкл" },
    ...tracks.map((t, i) => ({
      id: t.id,
      label: plain.filter((p) => p === plain[i]).length > 1 ? t.label : plain[i],
    })),
  ]
}
