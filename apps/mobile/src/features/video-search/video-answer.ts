import type { RootStackParamList } from "../../app/navigation"
import type { VideoAnswerCitation } from "../../shared/api/video-answers"

// The server's minimum question length (shorter ones are refused).
export const MIN_ASK_LENGTH = 5

export type AnswerPart =
  | { kind: "text"; text: string }
  | { kind: "citation"; citation: VideoAnswerCitation }

/**
 * The answer split into text and its [n] citations, for inline chips. A
 * number the citations don't have is left out (the server sends only real
 * ones; nothing must point nowhere).
 */
export const splitAnswer = (
  answer: string,
  citations: readonly VideoAnswerCitation[],
): AnswerPart[] => {
  const parts: AnswerPart[] = []
  let last = 0
  for (const match of answer.matchAll(/\[(\d+)\]/g)) {
    const at = match.index ?? 0
    if (at > last) parts.push({ kind: "text", text: answer.slice(last, at) })
    const citation = citations.find((c) => c.n === Number(match[1]))
    if (citation) parts.push({ kind: "citation", citation })
    last = at + match[0].length
  }
  if (last < answer.length) parts.push({ kind: "text", text: answer.slice(last) })
  return parts
}

/** Where a citation opens: the lesson at the cited moment. */
export const citationRoute = (
  citation: VideoAnswerCitation,
): RootStackParamList["Video"] => ({
  videoId: citation.videoId,
  courseId: citation.courseId ?? undefined,
  title: citation.title,
  startAt: citation.startAt,
})
