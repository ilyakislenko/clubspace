// Caption cues → on-screen lines and timings, and the .srt sidecar.
//
// A cue is `{ at, text }`: seconds on the raw recording when the scenario
// said it. The assembler drops the cut intervals and the lead-in before
// `start`, then shifts everything by the title card.

export const MAX_LINE = 42
export const MAX_LINES = 2
// A caption stays until the next one, but not forever: a long silent stretch
// of clicking shows the video alone.
const MAX_SHOW = 8
// Gap before the next caption, so two captions never touch.
const GAP = 0.15

// Words into ≤ MAX_LINE-char lines, two lines as even as possible (no lone
// last word); more than MAX_LINES lines is a copy error (fix the scenario's
// text), not something to shrink on screen.
export function wrapCaption(text) {
    const words = text.trim().split(/\s+/)
    const one = words.join(' ')
    if (one.length <= MAX_LINE) return [one]
    let best = null
    for (let i = 1; i < words.length; i++) {
        const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')]
        const longest = Math.max(lines[0].length, lines[1].length)
        if (longest <= MAX_LINE && (!best || longest < best.longest)) best = { lines, longest }
    }
    if (!best) throw new Error(`Caption longer than ${MAX_LINES}×${MAX_LINE}: «${text}»`)
    return best.lines
}

// Raw recording time → output time: minus the lead-in and every cut before it.
// Null when the moment itself was cut away.
export function mapTime(t, { start, end, cuts }) {
    if (t < start || t > end) return null
    let out = t - start
    for (const c of cuts) {
        if (t >= c.from && t < c.to) return null
        if (c.to <= t) out -= c.to - c.from
    }
    return out
}

// Kept intervals of the raw recording, in order.
export function keptSegments({ start, end, cuts }) {
    const segments = []
    let from = start
    for (const c of [...cuts].sort((a, b) => a.from - b.from)) {
        if (c.from > from) segments.push({ from, to: Math.min(c.from, end) })
        from = Math.max(from, c.to)
    }
    if (from < end) segments.push({ from, to: end })
    return segments.filter((s) => s.to - s.from > 0.05)
}

// Cues on the content timeline (no title card yet): `{ from, to, lines, top }`.
export function timeCues(cues, timeline) {
    const contentEnd = keptSegments(timeline).reduce((sum, s) => sum + s.to - s.from, 0)
    const mapped = cues
        .map((c) => ({ at: mapTime(c.at, timeline), text: c.text, top: Boolean(c.top) }))
        .filter((c) => c.at !== null)
    return mapped.map((c, i) => {
        const next = mapped[i + 1]?.at ?? contentEnd
        return {
            from: c.at,
            to: Math.min(next - (mapped[i + 1] ? GAP : 0), c.at + MAX_SHOW, contentEnd),
            lines: wrapCaption(c.text),
            top: c.top,
        }
    })
}

const srtTime = (sec) => {
    const ms = Math.max(0, Math.round(sec * 1000))
    const pad = (n, w = 2) => String(n).padStart(w, '0')
    return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`
}

// SubRip of the timed cues, shifted by `offset` (the title card).
export function toSrt(timed, offset) {
    return timed
        .map((c, i) => `${i + 1}\n${srtTime(c.from + offset)} --> ${srtTime(c.to + offset)}\n${c.lines.join('\n')}\n`)
        .join('\n')
}
