// Chapters the worker made; a staff edit turns one 'manual'.
export const AUTO_CHAPTER_SOURCES = ['ocr', 'speech']

export const countSources = (rows: Array<{ source: string }>, manual: (s: string) => boolean) => ({
    manual: rows.filter((r) => manual(r.source)).length,
    auto: rows.filter((r) => !manual(r.source)).length,
})
