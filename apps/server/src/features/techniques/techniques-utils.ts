import {
    TECHNIQUE_CATEGORIES,
    TECHNIQUE_CATEGORY_LABELS,
    type Technique,
    type TechniqueCategory,
} from '@clubspace/sport-glossary'

import { buildSnippet, type Highlight } from '../search-videos/search-videos-utils'

// A technique's page shows at most this many lessons, and moments per lesson.
export const MAX_TECHNIQUE_VIDEOS = 30
export const MAX_TECHNIQUE_MOMENTS = 8

export type MentionCount = {
    technique: string
    kind: string
    _count: { _all: number }
}
export type MentionVideo = { technique: string; videoId: string }

export type TechniqueSummary = {
    key: string
    en: string
    ru: string | null
    videoCount: number
    chapterCount: number
    speechCount: number
}

export type TechniqueGroup = {
    category: TechniqueCategory
    label: string
    techniques: TechniqueSummary[]
}

/** Whether the member's search names the technique (English or Russian). */
export const matchesTechniqueQuery = (t: Technique, query: string): boolean => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return [...t.spellings, t.ru ?? ''].some((name) => name.toLowerCase().includes(q))
}

/**
 * The catalogue as a member sees it: only techniques taught in lessons they
 * may watch, by category (glossary order), the ones with chapters of their
 * own first, then by how many lessons mention them.
 */
export const summarizeTechniques = (
    techniques: readonly Technique[],
    counts: readonly MentionCount[],
    videos: readonly MentionVideo[],
    query = '',
): TechniqueGroup[] => {
    const byKey = new Map<string, TechniqueSummary>()
    const order = new Map(techniques.map((t, i) => [t.key, i]))
    for (const t of techniques) {
        byKey.set(t.key, {
            key: t.key,
            en: t.en,
            ru: t.ru,
            videoCount: 0,
            chapterCount: 0,
            speechCount: 0,
        })
    }
    for (const c of counts) {
        const s = byKey.get(c.technique)
        if (!s) continue
        if (c.kind === 'chapter') s.chapterCount += c._count._all
        else s.speechCount += c._count._all
    }
    for (const v of videos) {
        const s = byKey.get(v.technique)
        if (s) s.videoCount += 1
    }
    return TECHNIQUE_CATEGORIES.map((category) => ({
        category,
        label: TECHNIQUE_CATEGORY_LABELS[category],
        techniques: techniques
            .filter((t) => t.category === category && matchesTechniqueQuery(t, query))
            .map((t) => byKey.get(t.key)!)
            .filter((s) => s.videoCount > 0)
            .sort(
                (a, b) =>
                    Number(b.chapterCount > 0) - Number(a.chapterCount > 0) ||
                    b.videoCount - a.videoCount ||
                    order.get(a.key)! - order.get(b.key)!,
            ),
    })).filter((g) => g.techniques.length > 0)
}

export type StoredMention = {
    videoId: string
    kind: string
    atSec: number
    text: string
    matched: string
}

export type TechniqueMoment = {
    atSec: number
    kind: 'chapter' | 'speech' | 'speechRu'
    snippet: string
    highlight: Highlight | null
}

export type TechniqueVideoMoments = {
    videoId: string
    chapterHits: number
    speechHits: number
    moments: TechniqueMoment[]
}

/**
 * The technique's lessons: the ones with a chapter on it first, then the
 * ones that talk about it most. Each lists its chapters first, then the
 * moments it's said (a translation at a second already shown is dropped).
 */
export const groupTechniqueMoments = (
    mentions: readonly StoredMention[],
): TechniqueVideoMoments[] => {
    const byVideo = new Map<string, StoredMention[]>()
    for (const m of mentions) {
        const list = byVideo.get(m.videoId) ?? []
        list.push(m)
        byVideo.set(m.videoId, list)
    }
    const groups: TechniqueVideoMoments[] = []
    for (const [videoId, list] of byVideo) {
        const chapters = list.filter((m) => m.kind === 'chapter').sort((a, b) => a.atSec - b.atSec)
        const spoken = list.filter((m) => m.kind !== 'chapter').sort((a, b) => a.atSec - b.atSec)
        const saidAt = new Set(spoken.filter((m) => m.kind === 'speech').map((m) => m.atSec))
        const speech = spoken.filter((m) => m.kind === 'speech' || !saidAt.has(m.atSec))
        groups.push({
            videoId,
            chapterHits: chapters.length,
            speechHits: speech.length,
            moments: [...chapters, ...speech].slice(0, MAX_TECHNIQUE_MOMENTS).map((m) => ({
                atSec: m.atSec,
                kind: m.kind as TechniqueMoment['kind'],
                ...buildSnippet(m.text, m.matched),
            })),
        })
    }
    return groups
        .sort(
            (a, b) =>
                Number(b.chapterHits > 0) - Number(a.chapterHits > 0) ||
                b.speechHits - a.speechHits ||
                a.videoId.localeCompare(b.videoId),
        )
        .slice(0, MAX_TECHNIQUE_VIDEOS)
}
