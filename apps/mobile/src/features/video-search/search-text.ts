import type { VideoSearchHighlight } from "../../shared/api/video-search"

// The server's minimum (shorter queries are refused).
export const MIN_VIDEO_QUERY = 2

export type TextPart = { text: string; hit: boolean }

/**
 * `text` split around the highlighted range, for bold rendering. A range that
 * doesn't fit the text (or none) leaves it whole.
 */
export const splitHighlight = (
  text: string,
  highlight: VideoSearchHighlight | null,
): TextPart[] => {
  if (
    !highlight ||
    highlight.length <= 0 ||
    highlight.start < 0 ||
    highlight.start + highlight.length > text.length
  ) {
    return [{ text, hit: false }]
  }
  const end = highlight.start + highlight.length
  return [
    { text: text.slice(0, highlight.start), hit: false },
    { text: text.slice(highlight.start, end), hit: true },
    { text: text.slice(end), hit: false },
  ].filter((part) => part.text.length > 0)
}

/** What kind of moment, for its label: «Глава», «Перевод» or nothing (speech). */
export const momentKindLabel = (kind: "chapter" | "speech" | "speechRu"): string | null =>
  kind === "chapter" ? "Глава" : kind === "speechRu" ? "Перевод" : null
