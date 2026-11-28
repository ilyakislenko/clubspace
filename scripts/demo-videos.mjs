#!/usr/bin/env node
// Gives every lesson of the demo clubs' courses a real clip in place of the
// «в обработке» placeholders the demo generator leaves there: renders a short
// clip per lesson with ffmpeg (the lesson title on its course's colours),
// uploads it through the API like the admin does, waits for the video worker
// to transcode it and swaps it into the course. Then draws the course covers
// and uploads student@'s «Разбор видео» clip.
//
//   npm run demo:videos                — both demo clubs, ACADEMY and «Ритм»
//   npm run demo:videos -- academy     — one club (or ritm)
//   npm run demo:videos -- --force     — redraw every lesson clip and cover
//
// --only-missing (the default) skips lessons that already play, so a second
// run only finishes what the first one did not. Needs the API (ROOT_URL),
// MinIO and the video worker running, and DEMO_LOGIN_CODE in .env.
// «Сбросить демо» deletes the clips with the rest of the club — run it again
// after a reset. Courses of `npm run demo:real-courses` are left alone.

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, openAsBlob, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'

if (existsSync('.env')) process.loadEnvFile('.env')

const API = (process.env.ROOT_URL || 'http://localhost:3000').replace(/\/$/, '')
const CODE = process.env.DEMO_LOGIN_CODE
const LESSON_SEC = 10
// Lessons with steps on screen, and the review clips.
const FEATURED_SEC = 15
// Lessons in flight at once (render → upload → transcode). The worker
// transcodes one at a time (TRANSCODE_CONCURRENCY=1): three keep it busy
// without a queue that outlasts READY_TIMEOUT_MS.
const CONCURRENCY = 3
const READY_TIMEOUT_MS = 5 * 60 * 1000

// Lessons that get their steps on screen instead of «Урок N из M», by the
// generator's lesson title (demo-club.catalog.ts, ritm-demo.plan.ts COURSES).
const ACADEMY_FEATURED = {
    'Выход из маунта «мостом»': {
        title: 'Выход из маунта «мостом»',
        description:
            'Пошаговый разбор выхода из-под маунта через мост: захват руки, блок стопы, переворот в гард.',
        steps: [
            'Прижмите локти и защитите шею',
            'Захватите руку соперника и прижмите её к себе',
            'Заблокируйте стопу с той же стороны',
            'Мост через плечо — и переворот',
            'Вы в гарде соперника: держите осанку',
        ],
    },
    Треугольник: {
        title: 'Удушение треугольником — разбор',
        description:
            'Треугольник из закрытого гарда по шагам: слом осанки, рука внутри, замок под коленом, угол и финиш.',
        steps: [
            'Сломайте осанку соперника в закрытом гарде',
            'Одна рука соперника внутри, другая снаружи',
            'Ногу на шею, замок под коленом',
            'Выйдите бедром в сторону — поправьте угол',
            'Притяните голову и сожмите колени',
        ],
    },
}

const RITM_FEATURED = {
    'Связка № 1 — восьмёрки': {
        title: 'Связка № 1 — восьмёрки',
        description: 'Восьмёрки бёдрами на каблуках: счёт, руки и выход в проходку. Повторяйте под музыку с занятия.',
        steps: [
            'Стопы на ширине бёдер, колени мягкие',
            '«Раз-два» — восьмёрка бёдрами вправо',
            '«Три-четыре» — восьмёрка влево',
            'Руки ведут от плеча, взгляд в зеркало',
            'Проходка на «пять-шесть-семь-восемь»',
        ],
    },
    'Связка № 2 — партер': {
        title: 'Связка № 2 — партер',
        description: 'Связка в партере: спуск на колени, волна корпусом и подъём. Наколенники обязательны.',
        steps: [
            'Спуск на колени через присед — спина прямая',
            'Волна корпусом от груди к бёдрам',
            'Мах ногой и перекат на бедро',
            'Подъём через колено на счёт «семь»',
            'Финальная поза — и в проходку',
        ],
    },
}

// The «Разбор видео» each club's student@ has waiting for the staff: the
// generator leaves it with a clip that has no media (demo-club.plan.ts
// addReviewPlaceholder); a real clip of the same title replaces it.
const ACADEMY_REVIEW = {
    email: 'student@academy.demo',
    title: 'Спарринг: защита от треугольника',
    message: 'Дважды попал в треугольник из закрытого гарда. Где я ошибаюсь при выходе?',
    subtitle: 'Разбор видео · спарринг в «Дворце спорта»',
    steps: [
        'Раунд 2 · 0:40 — соперник ломает осанку',
        'Рука осталась внутри, вторая снаружи',
        'Поздно ставлю локоть — нога уходит на шею',
        'Пытаюсь встать без контроля бёдер',
        'Тренер, где правильный момент для выхода?',
    ],
}
const RITM_REVIEW = {
    email: 'student@ritm.demo',
    title: 'High heels: Связка № 1',
    message: 'В конце связки не успеваю на восьмёрку — посмотрите, что не так с руками?',
    subtitle: 'Разбор видео · запись в Большом зале',
    steps: [
        '«Раз-два» — восьмёрка вправо',
        '«Три-четыре» — восьмёрка влево',
        'Руки отстают на «пять»',
        'Проходка начинается раньше счёта',
        'Педагог, как успеть с руками?',
    ],
}

// Which demo club (apps/server/src/domains/demo/demo-clubs.ts) and its
// sign-in accounts (demo-accounts.ts, ritm-demo.accounts.ts).
const CLUBS = {
    academy: {
        key: 'academy-demo', owner: 'owner@academy.demo', short: 'ACADEMY', brand: 'ACADEMY · Бразильское джиу-джитсу',
        featured: ACADEMY_FEATURED, review: ACADEMY_REVIEW,
        accounts: ['owner', 'admin', 'bjj', 'coach', 'student', 'parent'].map((name) => `${name}@academy.demo`),
    },
    ritm: {
        key: 'ritm-demo', owner: 'owner@ritm.demo', short: 'Ритм', brand: 'Студия танца «Ритм» · High heels',
        featured: RITM_FEATURED, review: RITM_REVIEW,
        accounts: ['owner', 'pedagog', 'student', 'parent'].map((name) => `${name}@ritm.demo`),
    },
}

// [background from, background to, accent] — one per course of a club (by
// slug), its clips and cover alike, so the courses tell apart at a glance.
const PALETTES = [
    ['0x0b1220', '0x172554', '0x38bdf8'],
    ['0x05200f', '0x14532d', '0x4ade80'],
    ['0x1a0b2e', '0x4c1d95', '0xc084fc'],
    ['0x1f0a0a', '0x7f1d1d', '0xf87171'],
    ['0x1c1305', '0x78350f', '0xfbbf24'],
    ['0x042f2e', '0x134e4a', '0x2dd4bf'],
    ['0x2a0a1e', '0x831843', '0xf472b6'],
]
const REVIEW_PALETTE = ['0x111827', '0x312e81', '0xa5b4fc']

// Two quiet sine notes per clip, a different pair per lesson.
const NOTES = [196, 220, 261.63, 293.66, 329.63, 392, 440]

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

const argv = process.argv.slice(2)
const badFlag = argv.find((a) => a.startsWith('--') && a !== '--force' && a !== '--only-missing')
if (badFlag) fail(`Неизвестный флаг ${badFlag} — есть --only-missing (по умолчанию) и --force.`)
const FORCE = argv.includes('--force')
if (FORCE && argv.includes('--only-missing')) fail('--force и --only-missing вместе не бывают — выберите одно.')
const names = argv.filter((a) => !a.startsWith('--'))
const selected = names.length === 0 || names.includes('all') ? Object.keys(CLUBS) : names
const unknown = selected.find((name) => !CLUBS[name])
if (unknown) fail(`Неизвестный демо-клуб «${unknown}» — ${Object.keys(CLUBS).join(', ')} или all.`)

const fontPair = FONTS.find(([regular, bold]) => existsSync(regular) && existsSync(bold))
if (!fontPair) fail('Не найден шрифт с кириллицей (Arial или DejaVu Sans).')
const [FONT, BOLD] = fontPair

const dir = mkdtempSync(join(tmpdir(), 'clubspace-demo-videos-'))
process.on('exit', () => rmSync(dir, { recursive: true, force: true }))

// ---- rendering --------------------------------------------------------------

// Fades a caption in at `from` and out at `to`.
const fade = (from, to, d = 0.4) =>
    `if(lt(t,${from}),0,if(lt(t,${from + d}),(t-${from})/${d},if(lt(t,${to - d}),1,if(lt(t,${to}),(${to}-t)/${d},0))))`

// drawtext reads captions from files: no escaping of quotes, colons or «».
const captioner = (prefix) => (name, value, opts) => {
    const path = join(dir, `${prefix}-${name}.txt`)
    writeFileSync(path, value)
    return `drawtext=fontfile='${opts.bold ? BOLD : FONT}':textfile='${path}':fontsize=${opts.size}:fontcolor=${opts.color}:x=${opts.x ?? '(w-text_w)/2'}:y=${opts.y}${opts.alpha ? `:alpha='${opts.alpha}'` : ''}`
}

// Words onto lines of at most `width` characters.
const wrap = (text, width) =>
    text.split(' ').reduce((acc, word) => {
        const last = acc[acc.length - 1]
        if (last && `${last} ${word}`.length <= width) acc[acc.length - 1] = `${last} ${word}`
        else acc.push(word)
        return acc
    }, [])

const ffmpeg = (args) =>
    new Promise((resolve) => {
        const child = spawn(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
            stdio: ['ignore', 'ignore', 'pipe'],
        })
        let stderr = ''
        child.stderr.on('data', (chunk) => {
            stderr += chunk
        })
        child.on('error', (err) => fail(`ffmpeg не запустился: ${err.message}`))
        child.on('close', (code) => (code === 0 ? resolve() : fail(`ffmpeg завершился с кодом ${code}: ${stderr.trim()}`)))
    })

// A clip: the club, the title on its course's colours, the course and
// chapter under it, then either the steps one by one or a note such as
// «Урок 3 из 8»; a progress bar and a timer at the bottom.
const renderClip = async (clip, name) => {
    const { duration, steps } = clip
    const [c0, c1, accent] = clip.palette
    const caption = captioner(name)
    const lines = wrap(clip.title, 30)
    const titleY = (steps ? 200 : 250) - (lines.length - 1) * 36
    const below = titleY + lines.length * 72 + 12
    const stepStart = 3
    const stepLen = steps ? (duration - stepStart) / steps.length : 0
    const filters = [
        caption('brand', clip.brand, { size: 26, color: '0x94a3b8', x: 64, y: 52 }),
        `drawbox=x=64:y=96:w=72:h=4:color=${accent}:t=fill`,
        ...lines.map((line, i) =>
            caption(`title${i}`, line, { bold: true, size: 60, color: 'white', y: titleY + i * 72, alpha: fade(0.2, duration + 1) }),
        ),
        caption('subtitle', clip.subtitle, { size: 28, color: '0xcbd5e1', y: below, alpha: fade(0.8, duration + 1) }),
        ...(steps
            ? steps.flatMap((step, i) => {
                  const alpha = fade(stepStart + i * stepLen, stepStart + (i + 1) * stepLen)
                  return [
                      caption(`n${i}`, `Шаг ${i + 1} из ${steps.length}`, { bold: true, size: 26, color: accent, y: below + 100, alpha }),
                      caption(`s${i}`, step, { size: 40, color: '0xe2e8f0', y: below + 145, alpha }),
                  ]
              })
            : [caption('note', clip.note, { bold: true, size: 28, color: accent, y: below + 70, alpha: fade(1.2, duration + 1) })]),
        `drawtext=fontfile='${FONT}':text='%{pts\\:gmtime\\:0\\:%M\\\\\\:%S} / 00\\:${String(duration).padStart(2, '0')}':fontsize=24:fontcolor=0x94a3b8:x=w-text_w-64:y=h-80`,
        caption('label', 'Демо-ролик ClubSpace', { size: 24, color: '0x64748b', x: 64, y: 'h-80' }),
        'drawbox=x=0:y=h-8:w=iw:h=8:color=0x1e293b:t=fill',
    ]
    const [low, high] = clip.tone
    const graph = [
        `gradients=s=1280x720:r=25:d=${duration}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=1280:y1=720:speed=0.004[bg]`,
        `color=c=${accent}:s=1280x8:r=25:d=${duration}[bar]`,
        `[bg]${filters.join(',')}[txt]`,
        `[txt][bar]overlay=x='-W+W*t/${duration}':y=H-8:shortest=1,format=yuv420p,fade=t=in:d=0.6,fade=t=out:st=${duration - 0.8}:d=0.8[v]`,
        `sine=f=${low}:d=${duration}[a0]`,
        `sine=f=${high}:d=${duration}[a1]`,
        `[a0][a1]amix=inputs=2,volume=0.12,afade=t=in:d=1.5,afade=t=out:st=${duration - 2}:d=2,aformat=channel_layouts=mono[a]`,
    ].join(';')
    const video = join(dir, `${name}.mp4`)
    await ffmpeg([
        '-filter_complex', graph, '-map', '[v]', '-map', '[a]',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
        '-c:a', 'aac', '-b:a', '64k', '-ar', '48000',
        '-t', String(duration), '-movflags', '+faststart', video,
    ])
    return video
}

// A course card's cover: the club, the course title (wrapped to two lines when
// long) and its lesson count on the course's colours, one 1280×720 JPEG.
const renderCover = async (club, course, name) => {
    const [c0, c1, accent] = course.palette
    const caption = captioner(name)
    const lines = wrap(course.title, 28)
    const n = course.lessons
    const top = lines.length > 1 ? 250 : 300
    const filters = [
        caption('brand', club.brand.split(' · ')[0], { size: 30, color: '0x94a3b8', x: 72, y: 72 }),
        `drawbox=x=72:y=124:w=88:h=5:color=${accent}:t=fill`,
        ...lines.map((line, i) => caption(`title${i}`, line, { bold: true, size: 56, color: 'white', x: 72, y: top + i * 72 })),
        caption('lessons', `Курс · ${n} ${n % 10 === 1 && n % 100 !== 11 ? 'урок' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'урока' : 'уроков'}`, { size: 32, color: '0x94a3b8', x: 72, y: top + lines.length * 72 + 28 }),
    ]
    const cover = join(dir, `${name}.jpg`)
    await ffmpeg([
        '-filter_complex',
        `gradients=s=1280x720:d=1:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=1280:y1=720,${filters.join(',')}`,
        '-frames:v', '1', '-q:v', '3', cover,
    ])
    return cover
}

// ---- API --------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const request = async (url, init) => {
    try {
        return await fetch(url, init)
    } catch {
        fail(`API не отвечает на ${API}.`)
    }
}

const post = (path, body) =>
    request(`${API}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })

// The demo accounts take the fixed code, but only while a requested code is
// pending: request one first. Right after someone else's sign-in the request
// is throttled (COMPLETE_CODE_TIMEOUT) — wait it out.
const signIn = async (email) => {
    const deadline = Date.now() + 3 * 60 * 1000
    for (;;) {
        const requested = await post('/send-auth-code', { email, language: 'RU' })
        const signedIn = await post('/sign-in', { email, code: CODE })
        if (signedIn.ok) return (await signedIn.json()).accessToken
        if (requested.ok || Date.now() > deadline) {
            fail(`Не удалось войти как ${email}: ${signedIn.status} ${await signedIn.text()}`)
        }
        console.log('• Вход: код только что запрашивали — жду…')
        await sleep(15_000)
    }
}

// Requests as one demo account; signs in again when the access token runs
// out (JWT_ACCESS_TOKEN_TTL, 15 minutes) in the middle of a long run. One
// sign-in per account: a second one within COMPLETE_CODE_TIMEOUT would wait.
const accounts = new Map()
const account = (email) => {
    if (!accounts.has(email)) accounts.set(email, signIn(email).then((first) => client(email, first)))
    return accounts.get(email)
}
const client = (email, first) => {
    let token = first
    return async (method, path, body) => {
        for (let retried = false; ; retried = true) {
            const response = await request(`${API}${path}`, {
                method,
                headers: {
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                    Authorization: `Bearer ${token}`,
                },
                body: body ? JSON.stringify(body) : undefined,
            })
            if (response.status === 401 && !retried) {
                token = await signIn(email)
                continue
            }
            if (!response.ok) fail(`${method} ${path} → ${response.status} ${await response.text()}`)
            const text = await response.text()
            return text ? JSON.parse(text) : null
        }
    }
}

const put = async (url, file, contentType) => {
    const response = await request(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: readFileSync(file) })
    if (!response.ok) {
        fail(`Хранилище отклонило загрузку (${response.status}): проверьте S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY в .env.`)
    }
}

// A clip bigger than one part goes up in parts (the server answers MULTIPART
// above S3_MULTIPART_PART_MB: storage behind Cloudflare refuses request bodies
// over 100 MB) — each part to its own presigned URL, its ETag kept for
// complete-upload, a failed part tried PART_ATTEMPTS times. One that still
// fails drops the upload (`abort`) and stops the run.
const PART_ATTEMPTS = 3
const putParts = async (upload, file, abort) => {
    const blob = await openAsBlob(file)
    const parts = []
    for (const { partNumber, url } of upload.parts) {
        const start = (partNumber - 1) * upload.partSize
        const body = blob.slice(start, start + upload.partSize)
        let etag = null
        let problem = ''
        let hint = ''
        for (let attempt = 1; attempt <= PART_ATTEMPTS && !etag; attempt++) {
            try {
                const response = await fetch(url, { method: 'PUT', body })
                await response.text()
                if (response.ok) {
                    etag = response.headers.get('etag')
                    problem = 'хранилище не вернуло ETag'
                    hint = 'прокси перед хранилищем не пропускает заголовок ETag'
                    break
                }
                problem = `код ${response.status}`
                // A refused signature stays refused; anything else is tried again.
                if (response.status === 403) {
                    hint = 'проверьте S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY в .env'
                    break
                }
                hint = 'хранилище отвечает ошибкой — посмотрите его логи'
            } catch (error) {
                problem = `хранилище не ответило: ${error.cause?.message ?? error.message}`
                hint = 'проверьте сеть и S3_UPLOAD_BUCKET_URL'
            }
        }
        if (!etag) {
            console.error(`✘ Часть ${partNumber} из ${upload.parts.length} не загрузилась (${problem}).`)
            await abort()
            fail(`Загрузка отменена: ${hint}, затем запустите команду ещё раз.`)
        }
        parts.push({ partNumber, etag })
    }
    return parts
}

// Polls `read` until it reports ready; fails on «failed» or after the timeout.
const waitReady = async (what, read) => {
    const deadline = Date.now() + READY_TIMEOUT_MS
    for (;;) {
        const { ready, failed } = await read()
        if (ready) return
        if (failed) fail(`Видео-воркер не смог обработать ${what}: ${failed}`)
        if (Date.now() > deadline) {
            fail(`${what} не обработан за 5 минут. Запущен ли видео-воркер: npx nx serve @clubspace/video-worker?`)
        }
        await sleep(1500)
    }
}

// Every video of the club's library, page by page.
const listLibrary = async (api, ws) => {
    const all = []
    for (let page = 1; ; page++) {
        const { data, total } = await api('GET', `/admin/videos?workspaceId=${ws}&perPage=100&curPage=${page}`)
        all.push(...data)
        if (data.length === 0 || all.length >= total) return all
    }
}

const elapsed = (from) => {
    const s = Math.round((Date.now() - from) / 1000)
    return s < 60 ? `${s} с` : `${Math.floor(s / 60)} мин ${s % 60} с`
}

// ---- what is missing --------------------------------------------------------

const started = Date.now()
const clubs = []
const tasks = []
let lessonCount = 0

for (const name of selected) {
    const def = CLUBS[name]
    const api = await account(def.owner)
    const { data: workspaces } = await api('POST', '/get-my-workspaces', { perPage: 100 })
    const workspace = workspaces.find((w) => w.key === def.key)
    if (!workspace) fail(`У ${def.owner} нет клуба ${def.key}.`)
    const ws = workspace.workspaceId
    const { data: list } = await api('GET', `/workspaces/${ws}/playlists?perPage=100`)
    const library = await listLibrary(api, ws)
    const club = { def, api, ws, courses: [], loose: [] }
    const lessonTitles = new Set()
    const featured = Object.entries(def.featured)

    for (const [ci, summary] of [...list].sort((a, b) => a.slug.localeCompare(b.slug)).entries()) {
        const path = `/workspaces/${ws}/playlists/${summary.id}`
        const { videos } = await api('GET', path)
        // A course of demo:real-courses holds the owner's real videos — not
        // ours to redraw, sweep or cover. Its uploads carry the course title as
        // description («<course>» or «<course> · <chapter>»); the generator's
        // lessons have «<course> — <chapter>».
        if (videos.some((v) => v.description === summary.title || v.description?.startsWith(`${summary.title} · `))) {
            console.log(`• ${def.short} · курс «${summary.title}» — из demo:real-courses, не трогаю`)
            continue
        }
        const palette = PALETTES[ci % PALETTES.length]
        const course = { ...summary, path, palette, lessons: videos.length, order: videos.map((v) => v.id), tasks: [] }
        club.courses.push(course)
        const claimed = new Set()
        videos.forEach((lesson, li) => {
            lessonCount++
            lessonTitles.add(lesson.title)
            if (claimed.has(lesson.id) || (lesson.status === 'ready' && !FORCE)) return
            // By the generator's title, or the clip's own once it replaced it.
            const extra = featured.find(([title, f]) => title === lesson.title || f.title === lesson.title)?.[1]
            const title = extra?.title ?? lesson.title
            // A run stopped between putting the clip into the course and
            // removing the old lesson: the clip is already here — finish that.
            const placed = videos.find((v) => v.id !== lesson.id && v.status === 'ready' && v.title === title && !claimed.has(v.id))
            if (placed) claimed.add(placed.id)
            const task = {
                club,
                course,
                lesson,
                palette,
                brand: def.brand,
                title,
                description: extra?.description ?? lesson.description ?? summary.title,
                subtitle: lesson.chapterTitle ? `${summary.title} · ${lesson.chapterTitle}` : summary.title,
                steps: extra?.steps,
                note: `Урок ${li + 1} из ${videos.length}`,
                duration: extra ? FEATURED_SEC : LESSON_SEC,
                tone: [NOTES[(ci + li) % NOTES.length], NOTES[(ci + li + 2) % NOTES.length]],
                videoId: placed?.id ?? null,
                attached: Boolean(placed),
                clipChapterId: placed?.chapterId ?? null,
            }
            tasks.push(task)
            course.tasks.push(task)
        })
        // A finished clip found for an unfinished swap is that lesson, not another.
        lessonCount -= claimed.size
        course.lessons -= claimed.size
    }
    // A run that stopped half-way leaves clips uploaded but never put into a
    // course: the ones a lesson still needs and that are ready or on their way
    // are picked up, the rest go — with the generator's own titles of the
    // renamed lessons («Треугольник»), in case one was left out of its course.
    const wanted = new Set(tasks.filter((t) => t.club === club && !t.videoId).map((t) => t.title))
    for (const v of library) {
        if (v.playlists.length > 0 || !(wanted.has(v.title) || lessonTitles.has(v.title) || def.featured[v.title])) continue
        if (wanted.has(v.title) && (v.status === 'ready' || v.status === 'processing')) club.loose.push(v)
        else await api('DELETE', `/admin/videos/${v.id}?workspaceId=${ws}`)
    }
    clubs.push(club)
}

// ---- lesson clips -----------------------------------------------------------

const pending = tasks.filter((t) => !t.videoId)
let done = 0
const runLesson = async (task, name) => {
    const { club, title } = task
    const { api, ws } = club
    const from = Date.now()
    const leftover = club.loose.findIndex((v) => v.title === title)
    if (leftover >= 0) {
        task.videoId = club.loose.splice(leftover, 1)[0].id
    } else {
        const video = await renderClip(task, name)
        const created = await api('POST', '/admin/videos', {
            workspaceId: ws,
            title,
            description: task.description,
            contentType: 'video/mp4',
            sizeBytes: readFileSync(video).length,
            // putParts below can send parts.
            multipart: true,
        })
        let parts
        if (created.upload.method === 'MULTIPART') {
            parts = await putParts(created.upload, video, () =>
                api('POST', `/admin/videos/${created.videoId}/abort-upload`, { workspaceId: ws }),
            )
        } else {
            await put(created.upload.url, video, 'video/mp4')
        }
        await api('POST', `/admin/videos/${created.videoId}/complete-upload`, { workspaceId: ws, parts })
        task.videoId = created.videoId
    }
    await waitReady(`Ролик «${title}»`, async () => {
        const { status, errorMessage } = await api('GET', `/admin/videos/${task.videoId}?workspaceId=${ws}`)
        return { ready: status === 'ready', failed: status === 'failed' ? (errorMessage ?? 'ошибка') : null }
    })
    done++
    const width = String(pending.length).length
    console.log(`✔ [${String(done).padStart(width)}/${pending.length}] ${club.def.short} · «${title}» — ${elapsed(from)}${leftover >= 0 ? ' (загружен прошлым запуском)' : ''}`)
}

// The clips take the old lessons' places — same chapter, same position — and
// the old videos go: the generator's placeholders, or with --force the
// previous clips. Every course edit is a row in «История изменений», so as few
// as it takes: one attach per course, a chapter per lesson, a move only for a
// clip that did not land in place, and one bulk delete per course (each old
// lesson's course entry goes with its video). The delete comes last and in
// one request: a run stopped earlier finds every placeholder of the course
// still next to its clip and finishes the job.
const finishCourse = async (club, course) => {
    const { api, ws } = club
    const fresh = course.tasks.filter((t) => !t.attached).map((t) => t.videoId)
    if (fresh.length > 0) await api('POST', `${course.path}/videos`, { videoIds: fresh })
    for (const t of course.tasks) {
        if (t.lesson.chapterId && t.clipChapterId !== t.lesson.chapterId) {
            await api('PATCH', `${course.path}/videos/${t.videoId}`, { chapterId: t.lesson.chapterId })
        }
    }
    const old = new Set(course.tasks.map((t) => t.lesson.id))
    const replacement = new Map(course.tasks.map((t) => [t.lesson.id, t.videoId]))
    const placed = new Set(course.tasks.filter((t) => t.attached).map((t) => t.videoId))
    const desired = course.order.filter((id) => !placed.has(id)).map((id) => replacement.get(id) ?? id)
    const { videos } = await api('GET', course.path)
    const current = videos.map((v) => v.id).filter((id) => !old.has(id))
    for (const [i, id] of desired.entries()) {
        if (current[i] === id) continue
        await api('PATCH', `${course.path}/videos/${id}/position`, { afterId: i === 0 ? null : desired[i - 1] })
        current.splice(current.indexOf(id), 1)
        current.splice(i, 0, id)
    }
    await api('POST', '/admin/videos/bulk', { workspaceId: ws, videoIds: [...old], action: 'delete' })
}

if (tasks.length === 0) {
    console.log(`• У всех уроков (${lessonCount}) уже есть ролик — пропускаю`)
} else {
    const recovered = tasks.length - pending.length
    console.log(
        `• Уроков: ${lessonCount}, ${FORCE ? 'перерисую все' : `с роликом: ${lessonCount - tasks.length}, без ролика: ${tasks.length}`}${recovered > 0 ? ` (у ${recovered} ролик уже в курсе — доделаю замену)` : ''} — рендер, загрузка и обработка по ${CONCURRENCY} одновременно…`,
    )
    let next = 0
    await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, pending.length) }, async () => {
            while (next < pending.length) {
                const i = next++
                await runLesson(pending[i], `lesson${i}`)
            }
        }),
    )
    for (const club of clubs) {
        for (const course of club.courses) {
            if (course.tasks.length === 0) continue
            await finishCourse(club, course)
            console.log(`✔ ${club.def.short} · курс «${course.title}»: ролики на месте (${course.tasks.length})`)
        }
    }
}

// ---- covers and reviews -----------------------------------------------------

for (const club of clubs) {
    const { def, api, ws } = club

    // Every course card without its own cover (with --force, every one) gets
    // one. A course without one shows its first lesson's thumbnail instead,
    // so «own» is a cover uploaded for the course (buildPlaylistThumbnailKey).
    for (const [index, c] of club.courses.entries()) {
        if (c.thumbnailUrl?.includes('/thumbnails/playlists/') && !FORCE) continue
        const cover = await renderCover(def, c, `cover-${def.short}-${index}`)
        const upload = await api('POST', `/workspaces/${ws}/playlists/${c.id}/thumbnail-upload`, { contentType: 'image/jpeg' })
        await put(upload.upload.url, cover, 'image/jpeg')
        await api('PATCH', `/workspaces/${ws}/playlists/${c.id}`, { thumbnailUrl: upload.publicUrl })
        console.log(`✔ ${def.short} · обложка курса «${c.title}»`)
    }

    // student@'s «Разбор видео»: a real clip in place of the generator's
    // placeholder (no media, «обрабатывается»), uploaded from the student's
    // account as the app does, so the coach can play it and comment.
    const review = def.review
    const student = await account(review.email)
    const reviewsPath = `/workspaces/${ws}/me/video-reviews`
    const { items } = await student('GET', reviewsPath)
    const mine = items.filter((r) => r.title === review.title)
    if (mine.some((r) => r.status !== 'processing' && r.status !== 'uploading' && r.status !== 'failed')) {
        console.log(`• ${def.short} · разбор «${review.title}» уже с роликом — пропускаю`)
        continue
    }
    const from = Date.now()
    const video = await renderClip(
        { ...review, brand: def.brand, palette: REVIEW_PALETTE, duration: FEATURED_SEC, tone: [NOTES[1], NOTES[4]] },
        `review-${def.short}`,
    )
    const created = await student('POST', reviewsPath, {
        title: review.title,
        message: review.message,
        contentType: 'video/mp4',
        sizeBytes: readFileSync(video).length,
        durationSec: FEATURED_SEC,
    })
    await put(created.upload.url, video, 'video/mp4')
    await student('POST', `${reviewsPath}/${created.request.id}/complete`)
    await waitReady('Разбор', async () => {
        const { items: now } = await student('GET', reviewsPath)
        const r = now.find((x) => x.id === created.request.id)
        return { ready: r?.status === 'open', failed: r?.status === 'failed' ? (r.clip.errorMessage ?? 'ошибка') : null }
    })
    for (const placeholder of mine) await student('DELETE', `${reviewsPath}/${placeholder.id}`)
    console.log(`✔ ${def.short} · разбор «${review.title}» — ${elapsed(from)}${mine.length > 0 ? ', заглушку убрал' : ''}`)
}

// Every clip that joins a published course tells the members who see it
// («Новое видео») — one per lesson, a pile of unread ones on the demo phones.
// The demo accounts get them marked read (they stay in the inbox) on every
// run, so a run stopped before this point is made good by the next one.
const VIDEO_KINDS = new Set(['video.published'])
for (const club of clubs) {
    let marked = 0
    for (const email of club.def.accounts) {
        const api = await account(email)
        const ids = []
        for (let page = 1; ; page++) {
            const { data, meta } = await api('GET', `/me/notifications?perPage=100&curPage=${page}`)
            ids.push(...data.filter((n) => !n.seen && VIDEO_KINDS.has(n.metadata?.kind)).map((n) => n.id))
            if (data.length === 0 || page * 100 >= meta.total) break
        }
        if (ids.length > 0) await api('POST', '/me/notifications/seen', { ids })
        marked += ids.length
    }
    if (marked > 0) console.log(`✔ ${club.def.short} · уведомления о новых роликах у демо-аккаунтов отмечены прочитанными (${marked})`)
}

console.log(`Готово за ${elapsed(started)}: у всех ${lessonCount} уроков ${selected.length > 1 ? 'обоих клубов ' : ''}есть ролик. В приложении: «Видео».`)
