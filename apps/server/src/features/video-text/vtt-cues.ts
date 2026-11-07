export type SubtitleCue = { from: number; to: number; text: string }

// 01:02:03.456 or 02:03.456 (the hour is optional in WebVTT).
const TIME = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/

const seconds = (value: string): number | null => {
    const m = TIME.exec(value.trim())
    if (!m) return null
    const [, h, min, s, ms] = m
    return Number(h ?? 0) * 3600 + Number(min) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000
}

/**
 * The cues of a WebVTT file, for staff's preview: start, end and text (tags
 * like <i> or <c.yellow> dropped, lines joined). Header, NOTE and STYLE blocks
 * and malformed cues are skipped.
 */
export const parseVttCues = (vtt: string): SubtitleCue[] => {
    const cues: SubtitleCue[] = []
    for (const block of vtt.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
        const lines = block.split('\n')
        const at = lines.findIndex((line) => line.includes('-->'))
        if (at < 0) continue
        const [start, rest = ''] = lines[at].split('-->')
        const from = seconds(start)
        const to = seconds(rest.trim().split(/\s+/)[0] ?? '')
        if (from === null || to === null) continue
        const text = lines
            .slice(at + 1)
            .map((line) => line.replace(/<[^>]*>/g, '').trim())
            .filter(Boolean)
            .join('\n')
        if (text) cues.push({ from, to, text })
    }
    return cues
}
