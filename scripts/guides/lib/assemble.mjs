// Raw recording + timeline + cues → the published guide: a 2 s title card,
// the trimmed recording (cuts removed) in its frame with burned-in captions,
// a short end card; 1920×1080 H.264 yuv420p 30 fps with a silent AAC track,
// plus a poster JPG and an .srt sidecar.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { keptSegments, mapTime, timeCues, toSrt } from './captions.mjs'
import { config } from './env.mjs'
import { H, LAYOUTS, openRenderer, W } from './render.mjs'

export const TITLE_SEC = 2
export const END_SEC = 3
const FPS = 30
const BACKDROP = '0x0b1220'

const ffmpeg = (args) => execFileSync(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })

export const probeDuration = (file) =>
    Number(
        execFileSync(config.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
            .toString()
            .trim(),
    )

// Scale the recording into its hole and lay it on the 1920×1080 canvas.
const placeFilter = (kind) => {
    const l = LAYOUTS[kind]
    return `scale=${l.w}:${l.h}:flags=lanczos,setsar=1,pad=${W}:${H}:${l.x}:${l.y}:color=${BACKDROP}`
}

export async function assemble(guide, recording) {
    const dir = join(config.workDir, guide.id, 'assemble')
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    mkdirSync(config.outDir, { recursive: true })

    const { kind, video, cues } = recording
    // The webm can end a little before our clock: never trim past it.
    const timeline = { ...recording.timeline, end: Math.min(recording.timeline.end, probeDuration(video)) }
    const segments = keptSegments(timeline)
    const contentSec = segments.reduce((s, x) => s + x.to - x.from, 0)
    const timed = timeCues(cues, timeline)

    const r = await openRenderer()
    const png = (name) => join(dir, `${name}.png`)
    try {
        await r.titleCard(guide, png('title'))
        await r.endCard(guide, config.publicHelpUrl, png('end'))
        await r.frame(guide, kind, png('frame'))
        await r.posterStrip(guide, png('strip'))
        await r.blank(png('blank'))
        for (const [i, c] of timed.entries()) await r.caption(c.lines, kind, c.top, png(`cap-${i}`))
    } finally {
        await r.close()
    }

    // Captions as one image sequence: blank / caption / blank … (concat demuxer).
    const list = []
    let t = 0
    for (const [i, c] of timed.entries()) {
        if (c.from > t) list.push([png('blank'), c.from - t])
        list.push([png(`cap-${i}`), c.to - Math.max(c.from, t)])
        t = c.to
    }
    if (contentSec > t) list.push([png('blank'), contentSec - t])
    const listFile = join(dir, 'captions.txt')
    writeFileSync(
        listFile,
        `ffconcat version 1.0\n${list.map(([f, d]) => `file '${f}'\nduration ${d.toFixed(3)}\n`).join('')}file '${png('blank')}'\n`,
    )

    const total = TITLE_SEC + contentSec + END_SEC
    const base = `${guide.id}-${config.version}`
    const mp4 = join(config.outDir, `${base}.mp4`)
    const cuts = segments.map((s, i) => `[r${i}]trim=start=${s.from.toFixed(3)}:end=${s.to.toFixed(3)},setpts=PTS-STARTPTS[s${i}]`)
    const filter = [
        `[0:v]fps=${FPS},split=${segments.length}${segments.map((_, i) => `[r${i}]`).join('')}`,
        ...cuts,
        `${segments.map((_, i) => `[s${i}]`).join('')}concat=n=${segments.length}:v=1:a=0[raw]`,
        `[raw]${placeFilter(kind)}[placed]`,
        `[placed][1:v]overlay=0:0:shortest=1[framed]`,
        `[2:v]fps=${FPS},format=rgba[caps]`,
        `[framed][caps]overlay=0:0:eof_action=pass,format=yuv420p,fade=t=in:st=0:d=0.3[content]`,
        `[3:v]fps=${FPS},setsar=1,format=yuv420p,fade=t=out:st=${TITLE_SEC - 0.3}:d=0.3[title]`,
        `[4:v]fps=${FPS},setsar=1,format=yuv420p,fade=t=in:st=0:d=0.3[end]`,
        `[title][content][end]concat=n=3:v=1:a=0,settb=1/${FPS * 1000}[v]`,
    ].join(';')
    ffmpeg([
        '-i', video,
        '-loop', '1', '-i', png('frame'),
        '-f', 'concat', '-safe', '0', '-i', listFile,
        '-loop', '1', '-t', String(TITLE_SEC), '-framerate', String(FPS), '-i', png('title'),
        '-loop', '1', '-t', String(END_SEC), '-framerate', String(FPS), '-i', png('end'),
        '-f', 'lavfi', '-t', total.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo',
        '-filter_complex', filter,
        '-map', '[v]', '-map', '5:a',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
        '-r', String(FPS), '-g', String(FPS * 2),
        '-c:a', 'aac', '-b:a', '64k',
        '-movflags', '+faststart', '-shortest',
        mp4,
    ])

    // Poster: a moment of the recording without its caption, with the title.
    const posterRaw = recording.posterAt ?? segments[Math.floor(segments.length / 2)].from + 1
    if (mapTime(posterRaw, timeline) === null) throw new Error(`${guide.id}: poster moment is cut away`)
    const poster = join(config.outDir, `${base}.jpg`)
    ffmpeg([
        '-ss', posterRaw.toFixed(3), '-i', video,
        '-i', png('frame'), '-i', png('strip'),
        '-filter_complex', `[0:v]${placeFilter(kind)}[p];[p][1:v]overlay=0:0[f];[f][2:v]overlay=0:0,format=yuvj420p[v]`,
        '-map', '[v]', '-frames:v', '1', '-q:v', '3',
        poster,
    ])

    writeFileSync(join(config.outDir, `${base}.srt`), toSrt(timed, TITLE_SEC))

    const durationSec = Math.round(probeDuration(mp4))
    for (const c of timed) {
        if (c.to - c.from < 1.8) console.warn(`  ⚠ ${guide.id}: «${c.lines.join(' ')}» is on screen only ${(c.to - c.from).toFixed(1)} s`)
    }
    return { file: `${base}.mp4`, poster: `${base}.jpg`, srt: `${base}.srt`, durationSec }
}
