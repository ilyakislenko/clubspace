import type { Chapter } from './chapters.js'
import {
    type ChapterContext,
    type ChatMessage,
    describeVideo,
    formatClock,
    itemsOf,
    parseJsonLoosely,
} from './speech-chapters.js'

// A second opinion on the titles OCR found, when a chat model is configured:
// text on screen that passes every heuristic can still be a gym banner or a
// T-shirt print («CLUB CLUE»). The model sees the video's and course's titles
// and the candidates and names the ones that are not captions. Asked which to
// keep instead, a small local model keeps only the titles it finds most
// "technical" and drops real ones like «Review». Side-effect free — speech.ts
// sends the request.

/** The request: the candidates numbered, with their times and the video's titles. */
export const buildTitleReviewPrompt = (
    context: ChapterContext,
    chapters: Chapter[],
): ChatMessage[] => [
    {
        role: 'system',
        content: [
            'You check text that OCR read off the screen of an instructional training video (martial arts, fitness, yoga or similar).',
            'Instructional videos show captions naming the technique, position, drill or concept taught from that moment, and most of the text below usually is such captions — including short ones like "Review", "Drills" or "Do\'s & Don\'ts", and ones with small reading errors.',
            'Reject only text that is clearly not such a caption: gym banners and wall signs, logos, sponsor or brand names, event names, clothing prints, watermarks, OCR garbage.',
            'Answer with JSON only, in this shape: {"reject":[2,5]} — the numbers of the texts that are not captions, or an empty list.',
        ].join('\n'),
    },
    {
        role: 'user',
        content: [
            ...describeVideo(context),
            'Text read off the screen:',
            ...chapters.map(
                (chapter, idx) =>
                    `${idx + 1}. [${formatClock(chapter.positionSec)}] ${chapter.title}`,
            ),
        ].join('\n'),
    },
]

/**
 * The chapters the model did not reject, in their order. It may name them
 * by number or by title, and may answer with the ones to keep instead
 * (`{"keep":[…]}`). An answer without a list (`{}`, prose) rejects nothing:
 * the heuristics already kept these.
 */
export const parseTitleReview = (content: string, chapters: Chapter[]): Chapter[] => {
    const parsed = parseJsonLoosely(content)
    const keepList =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'keep' in parsed
            ? parsed.keep
            : undefined
    const listed = new Set<number>()
    for (const item of Array.isArray(keepList) ? keepList : (itemsOf(parsed) ?? [])) {
        const idx =
            typeof item === 'number'
                ? item - 1
                : typeof item === 'string'
                  ? chapters.findIndex(
                        (chapter) => chapter.title.toLowerCase() === item.trim().toLowerCase(),
                    )
                  : -1
        listed.add(idx)
    }
    return chapters.filter((_, idx) => listed.has(idx) === Array.isArray(keepList))
}
