#!/usr/bin/env node
// Puts two short demo clips into a demo club's course, in place of the «в
// обработке» placeholders the demo generator leaves there: renders them with
// ffmpeg, uploads them through the API like the admin does, waits for the
// video worker to transcode them and swaps them into the course.
//
//   npm run demo:videos            — ACADEMY, «БЖЖ: база белого пояса»
//   npm run demo:videos -- ritm    — «Ритм», «High heels: связки для начинающих»
//
// Needs the API (ROOT_URL), MinIO and the video worker running, and
// DEMO_LOGIN_CODE in .env. «Сбросить демо» deletes the clips with the rest of
// the club — run it again after a reset. Lessons that already have their clip
// are skipped.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'

if (existsSync('.env')) process.loadEnvFile('.env')

const API = (process.env.ROOT_URL || 'http://localhost:3000').replace(/\/$/, '')
const CODE = process.env.DEMO_LOGIN_CODE
const DURATION = 30
const READY_TIMEOUT_MS = 5 * 60 * 1000

const ACADEMY_CLIPS = [
    {
        lesson: 'Выход из маунта «мостом»',
        title: 'Выход из маунта «мостом»',
        description:
            'Пошаговый разбор выхода из-под маунта через мост: захват руки, блок стопы, переворот в гард.',
        subtitle: 'БЖЖ: база белого пояса · Выходы из-под удержаний',
        steps: [
            'Прижмите локти и защитите шею',
            'Захватите руку соперника и прижмите её к себе',
            'Заблокируйте стопу с той же стороны',
            'Мост через плечо — и переворот',
            'Вы в гарде соперника: держите осанку',
        ],
        tone: [196, 293.66],
    },
    {
        lesson: 'Треугольник',
        title: 'Удушение треугольником — разбор',
        description:
            'Треугольник из закрытого гарда по шагам: слом осанки, рука внутри, замок под коленом, угол и финиш.',
        subtitle: 'БЖЖ: база белого пояса · Закрытый гард',
        steps: [
            'Сломайте осанку соперника в закрытом гарде',
            'Одна рука соперника внутри, другая снаружи',
            'Ногу на шею, замок под коленом',
            'Выйдите бедром в сторону — поправьте угол',
            'Притяните голову и сожмите колени',
        ],
        tone: [220, 329.63],
    },
]

const RITM_CLIPS = [
    {
        lesson: 'Связка № 1 — восьмёрки',
        title: 'Связка № 1 — восьмёрки',
        description: 'Восьмёрки бёдрами на каблуках: счёт, руки и выход в проходку. Повторяйте под музыку с занятия.',
        subtitle: 'High heels: связки для начинающих · Связки',
        steps: [
            'Стопы на ширине бёдер, колени мягкие',
            '«Раз-два» — восьмёрка бёдрами вправо',
            '«Три-четыре» — восьмёрка влево',
            'Руки ведут от плеча, взгляд в зеркало',
            'Проходка на «пять-шесть-семь-восемь»',
        ],
        tone: [261.63, 392],
    },
    {
        lesson: 'Связка № 2 — партер',
        title: 'Связка № 2 — партер',
        description: 'Связка в партере: спуск на колени, волна корпусом и подъём. Наколенники обязательны.',
        subtitle: 'High heels: связки для начинающих · Связки',
        steps: [
            'Спуск на колени через присед — спина прямая',
            'Волна корпусом от груди к бёдрам',
            'Мах ногой и перекат на бедро',
            'Подъём через колено на счёт «семь»',
            'Финальная поза — и в проходку',
        ],
        tone: [293.66, 440],
    },
]

// Which demo club (apps/server/src/domains/demo/demo-clubs.ts).
const CLUBS = {
    academy: { key: 'academy-demo', owner: 'owner@academy.demo', course: 'bjj-white-belt', brand: 'ACADEMY · Бразильское джиу-джитсу', clips: ACADEMY_CLIPS },
    ritm: { key: 'ritm-demo', owner: 'owner@ritm.demo', course: 'heels-basics', brand: 'Студия танца «Ритм» · High heels', clips: RITM_CLIPS },
}

const FONTS = [
    ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf'],
    ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
    ['/usr/share/fonts/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf'],
]

const fail = (message) => {
    console.error(`✘ ${message}`)
    process.exit(1)
}

if (!CODE) fail('В .env нет DEMO_LOGIN_CODE — демо-клуб не включён.')
const club = CLUBS[process.argv[2] ?? 'academy']
if (!club) fail(`Неизвестный демо-клуб «${process.argv[2]}» — ${Object.keys(CLUBS).join(' или ')}.`)
const { key: WORKSPACE_KEY, owner: OWNER_EMAIL, course: COURSE_SLUG, clips: CLIPS } = club

// ---- rendering --------------------------------------------------------------

// Fades a caption in at `from` and out at `to`.
const fade = (from, to, d = 0.4) =>
    `if(lt(t,${from}),0,if(lt(t,${from + d}),(t-${from})/${d},if(lt(t,${to - d}),1,if(lt(t,${to}),(${to}-t)/${d},0))))`

const render = (clip, dir, index) => {
    const fonts = FONTS.find(([regular, bold]) => existsSync(regular) && existsSync(bold))
    if (!fonts) fail('Не найден шрифт с кириллицей (Arial или DejaVu Sans).')
    const [font, bold] = fonts
    // drawtext reads captions from files: no escaping of quotes, colons or «».
    const text = (name, value) => {
        const path = join(dir, `${index}-${name}.txt`)
        writeFileSync(path, value)
        return path
    }
    const caption = (name, value, opts) =>
        `drawtext=fontfile='${opts.bold ? bold : font}':textfile='${text(name, value)}':fontsize=${opts.size}:fontcolor=${opts.color}:x=${opts.x ?? '(w-text_w)/2'}:y=${opts.y}${opts.alpha ? `:alpha='${opts.alpha}'` : ''}`

    const stepStart = 4
    const stepLen = (DURATION - stepStart) / clip.steps.length
    const filters = [
        caption('brand', club.brand, { size: 26, color: '0x94a3b8', x: 64, y: 52 }),
        'drawbox=x=64:y=96:w=72:h=4:color=0x38bdf8:t=fill',
        caption('title', clip.title, { bold: true, size: 60, color: 'white', y: 230, alpha: fade(0.2, DURATION + 1) }),
        caption('subtitle', clip.subtitle, { size: 28, color: '0x94a3b8', y: 320, alpha: fade(0.8, DURATION + 1) }),
        ...clip.steps.flatMap((step, i) => {
            const alpha = fade(stepStart + i * stepLen, stepStart + (i + 1) * stepLen)
            return [
                caption(`n${i}`, `Шаг ${i + 1} из ${clip.steps.length}`, { bold: true, size: 26, color: '0x38bdf8', y: 430, alpha }),
                caption(`s${i}`, step, { size: 40, color: '0xe2e8f0', y: 475, alpha }),
            ]
        }),
        `drawtext=fontfile='${font}':text='%{pts\\:gmtime\\:0\\:%M\\\\\\:%S} / 00\\:${DURATION}':fontsize=24:fontcolor=0x94a3b8:x=w-text_w-64:y=h-80`,
        caption('label', 'Демо-ролик ClubSpace', { size: 24, color: '0x64748b', x: 64, y: 'h-80' }),
        'drawbox=x=0:y=h-8:w=iw:h=8:color=0x1e293b:t=fill',
    ]
    const graph = [
        `gradients=s=1280x720:r=30:d=${DURATION}:c0=0x0b1220:c1=0x172554:x0=0:y0=0:x1=1280:y1=720:speed=0.004[bg]`,
        `color=c=0x38bdf8:s=1280x8:r=30:d=${DURATION}[bar]`,
        `[bg]${filters.join(',')}[txt]`,
        `[txt][bar]overlay=x='-W+W*t/${DURATION}':y=H-8:shortest=1,format=yuv420p,fade=t=in:d=0.6,fade=t=out:st=${DURATION - 0.8}:d=0.8[v]`,
        `sine=f=${clip.tone[0]}:d=${DURATION}[a0]`,
        `sine=f=${clip.tone[1]}:d=${DURATION}[a1]`,
        `[a0][a1]amix=inputs=2,volume=0.12,afade=t=in:d=1.5,afade=t=out:st=${DURATION - 2}:d=2,aformat=channel_layouts=stereo[a]`,
    ].join(';')
    const video = join(dir, `${index}.mp4`)
    const poster = join(dir, `${index}.jpg`)
    const run = (args) => {
        const result = spawnSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' })
        if (result.status !== 0) fail(`ffmpeg завершился с кодом ${result.status}`)
    }
    run([
        '-filter_complex', graph, '-map', '[v]', '-map', '[a]',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
        '-t', String(DURATION), '-movflags', '+faststart', video,
    ])
    run(['-ss', '6', '-i', video, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '3', poster])
    return { video, poster }
}

// ---- API --------------------------------------------------------------------

let token = null

const api = async (method, path, body) => {
    const response = await fetch(`${API}${path}`, {
        method,
        headers: {
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
        fail(`${method} ${path} → ${response.status} ${await response.text()}`)
    }
    const text = await response.text()
    return text ? JSON.parse(text) : null
}

const put = async (url, file, contentType) => {
    const data = readFileSync(file)
    const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: data })
    if (!response.ok) {
        fail(`Хранилище отклонило загрузку (${response.status}): проверьте S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY в .env.`)
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const post = (path, body) =>
    fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })

// The demo accounts take the fixed code, but only while a requested code is
// pending: request one first. Right after someone else's sign-in the request
// is throttled (COMPLETE_CODE_TIMEOUT) — wait it out.
const signIn = async () => {
    const deadline = Date.now() + 3 * 60 * 1000
    for (;;) {
        let requested
        try {
            requested = await post('/send-auth-code', { email: OWNER_EMAIL, language: 'RU' })
        } catch {
            fail(`API не отвечает на ${API}.`)
        }
        const signedIn = await post('/sign-in', { email: OWNER_EMAIL, code: CODE })
        if (signedIn.ok) return (await signedIn.json()).accessToken
        if (requested.ok || Date.now() > deadline) {
            fail(`Не удалось войти как ${OWNER_EMAIL}: ${signedIn.status} ${await signedIn.text()}`)
        }
        console.log('• Вход: код только что запрашивали — жду…')
        await sleep(15_000)
    }
}

token = await signIn()
const { data: workspaces } = await api('POST', '/get-my-workspaces', { perPage: 100 })
const workspace = workspaces.find((w) => w.key === WORKSPACE_KEY)
if (!workspace) fail(`У ${OWNER_EMAIL} нет клуба ${WORKSPACE_KEY}.`)
const ws = workspace.workspaceId
const { data: courses } = await api('GET', `/workspaces/${ws}/playlists?perPage=100`)
const course = courses.find((c) => c.slug === COURSE_SLUG)
if (!course) fail(`В демо-клубе нет курса ${COURSE_SLUG}.`)
const coursePath = `/workspaces/${ws}/playlists/${course.id}`

const dir = mkdtempSync(join(tmpdir(), 'clubspace-demo-videos-'))
try {
    for (const [index, clip] of CLIPS.entries()) {
        const { videos } = await api('GET', coursePath)
        // Clips join the course only once ready; a «processing» lesson of the
        // same name is the generator's placeholder.
        if (videos.some((v) => v.title === clip.title && v.status === 'ready')) {
            console.log(`• «${clip.title}» уже в курсе — пропускаю`)
            continue
        }
        const placeholder = videos.find((v) => v.title === clip.lesson && v.status === 'processing')

        console.log(`• «${clip.title}»: рендер…`)
        const { video, poster } = render(clip, dir, index)

        console.log('  загрузка…')
        const created = await api('POST', '/admin/videos', {
            workspaceId: ws,
            title: clip.title,
            description: clip.description,
            contentType: 'video/mp4',
            sizeBytes: readFileSync(video).length,
        })
        await put(created.upload.url, video, 'video/mp4')
        await api('POST', `/admin/videos/${created.videoId}/complete-upload`, { workspaceId: ws })
        const thumbnail = await api('POST', `/admin/videos/${created.videoId}/thumbnail-upload`, {
            workspaceId: ws,
            contentType: 'image/jpeg',
        })
        await put(thumbnail.upload.url, poster, 'image/jpeg')
        await api('PATCH', `/admin/videos/${created.videoId}`, {
            workspaceId: ws,
            thumbnailUrl: thumbnail.publicUrl,
        })

        console.log('  обработка…')
        const deadline = Date.now() + READY_TIMEOUT_MS
        for (;;) {
            const { status, errorMessage } = await api('GET', `/admin/videos/${created.videoId}?workspaceId=${ws}`)
            if (status === 'ready') break
            if (status === 'failed') fail(`Видео-воркер не смог обработать ролик: ${errorMessage}`)
            if (Date.now() > deadline) {
                fail('Ролик не обработан за 5 минут. Запущен ли видео-воркер: npx nx serve @clubspace/video-worker?')
            }
            await sleep(2000)
        }

        await api('POST', `${coursePath}/videos`, { videoIds: [created.videoId] })
        if (placeholder) {
            const lesson = `${coursePath}/videos/${created.videoId}`
            await api('PATCH', lesson, { chapterId: placeholder.chapterId })
            await api('PATCH', `${lesson}/position`, { afterId: placeholder.id })
            await api('DELETE', `${coursePath}/videos/${placeholder.id}`)
            await api('DELETE', `/admin/videos/${placeholder.id}?workspaceId=${ws}`)
        }
        console.log(`  ✔ готово${placeholder ? ` — заменил заглушку «${clip.lesson}»` : ''}`)
    }
} finally {
    rmSync(dir, { recursive: true, force: true })
}

console.log(`Курс «${course.title}»: ролики на месте. В приложении: Видео → «${course.title}».`)
