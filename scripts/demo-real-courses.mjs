#!/usr/bin/env node
// Turns folders of real video files on this Mac into published courses of the
// ACADEMY demo club — the owner's own material for private demos, never in git.
//
//   npm run demo:real-courses -- "<folder>" ["<folder>" …]
//
// A folder becomes a course titled after it («octopus 2.0» → «Octopus 2.0»):
//  - root files `Vol-<N>-<M>` → chapter «Том N», lesson «Часть M», in order;
//  - each subfolder → a chapter named after it, deeper folders flattened into
//    it (its own files first, then the deeper ones);
//  - any other root file → chapter «Разное» (no chapter when the course has
//    none); a lesson is titled after its file (no extension, tidied «_»).
// Only video files go up (mp4, mov, m4v, mkv, webm); anything else is skipped
// and named. An image next to a video with the same name is its poster.
// The presentation clips (CLIPS below) are not a course of their own: each
// replaces the generated clip of the demo lesson it shows, or, without such a
// lesson, joins the course «Разборы техники».
//
// A course is created as a draft with the audience of «БЖЖ: база белого
// пояса» and published once all its lessons play — one «Новый курс» instead
// of a push per lesson. Re-running is safe: lessons already in a course
// (course + chapter + title) are skipped, uploads a stopped run left outside
// the course are picked up. Needs the API (ROOT_URL), MinIO, the video worker
// and DEMO_LOGIN_CODE in .env. «Сбросить демо» deletes the club with these
// videos: run `npm run demo:videos`, then this again.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import ffmpegPath from 'ffmpeg-static'

if (existsSync('.env')) process.loadEnvFile('.env')

const API = (process.env.ROOT_URL || 'http://localhost:3000').replace(/\/$/, '')
const CODE = process.env.DEMO_LOGIN_CODE
const OWNER = 'owner@academy.demo'
const CLUB_KEY = 'academy-demo'
// The demo accounts whose «Новое видео» / «Новый курс» get marked read
// (demo-accounts.ts), as demo-videos.mjs does.
const ACCOUNTS = ['owner', 'admin', 'bjj', 'coach', 'student', 'parent'].map((name) => `${name}@academy.demo`)
const NOTICE_KINDS = new Set(['video.published', 'course.published'])
// The course whose audience the new courses copy (demo-club.catalog.ts).
const AUDIENCE_FROM = 'БЖЖ: база белого пояса'
const LEVEL = 'Все уровни'
// Uploads at once: the worker transcodes one by one anyway.
const CONCURRENCY = 3
// No video finished for this long: the worker is stuck or not running.
const STALL_MS = 45 * 60 * 1000

const VIDEO_TYPES = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.webm': 'video/webm' }
const POSTER_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

// The presentation clips, by file name: the demo lesson each one shows. The
// first match wins, «БЖЖ: база белого пояса» first (the kids' course has a
// «Выход из маунта» of its own).
const CLIPS = {
    treugolnik: { lesson: /треугольник/i, title: 'Треугольник' },
    'vyhod-iz-maunta': { lesson: /выход из маунта/i, title: 'Выход из маунта' },
}
const CLIPS_COURSE = 'Разборы техники'
const LOOSE_CHAPTER = 'Разное'

const fail = (message) => {
    console.error(`✖ ${message}`)
    process.exit(1)
}

if (!CODE) fail('В .env нет DEMO_LOGIN_CODE — демо-клуб не включён.')
const dirs = process.argv.slice(2)
if (dirs.length === 0) fail('Укажите папки с видео: npm run demo:real-courses -- "<папка>" ["<папка>" …]')

const natural = (a, b) => a.localeCompare(b, 'ru', { numeric: true, sensitivity: 'base' })
const capitalize = (s) => s.charAt(0).toLocaleUpperCase('ru') + s.slice(1)
// File names lose «:» and «|» on download: «Armbar_ 4 Mistakes» → «Armbar: 4
// Mistakes», «3.14 _ Exploring» → «3.14 — Exploring», other «_» → spaces.
const tidy = (name) =>
    capitalize(
        name
            .replace(/\s+_\s+/g, ' — ')
            .replace(/_\s/g, ': ')
            .replace(/_/g, ' ')
            .replace(/\s+/g, ' ')
            .trim(),
    )
const plural = (n, one, few, many) => {
    const d = n % 10
    const dd = n % 100
    return `${n} ${d === 1 && dd !== 11 ? one : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many}`
}
const TRANSLIT = Object.fromEntries(
    [...'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'].map((c, i) =>
        [c, ['a', 'b', 'v', 'g', 'd', 'e', 'e', 'zh', 'z', 'i', 'y', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't', 'u', 'f', 'h', 'ts', 'ch', 'sh', 'sch', '', 'y', '', 'e', 'yu', 'ya'][i]],
    ),
)
const slugify = (title) =>
    [...title.toLowerCase()].map((c) => TRANSLIT[c] ?? c).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'course'

const sizeMb = (bytes) => `${Math.round(bytes / 1024 / 1024)} МБ`
const elapsed = (from) => {
    const s = Math.round((Date.now() - from) / 1000)
    if (s < 60) return `${s} с`
    const m = Math.floor(s / 60)
    return m < 60 ? `${m} мин ${s % 60} с` : `${Math.floor(m / 60)} ч ${m % 60} мин`
}

// Seconds of a local file, from ffmpeg's header dump.
const probeDuration = (file) => {
    const { stderr } = spawnSync(ffmpegPath, ['-hide_banner', '-i', file], { encoding: 'utf8' })
    const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr ?? '')
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null
}

// ---- what is on disk --------------------------------------------------------

const skipped = []
const clips = []

// Videos of one folder (posters matched by name), the rest reported.
const readFolder = (dir) => {
    const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.'))
    const files = entries.filter((e) => e.isFile()).map((e) => e.name)
    const stems = new Set(files.filter((f) => VIDEO_TYPES[extname(f).toLowerCase()]).map((f) => basename(f, extname(f))))
    const videos = []
    for (const name of files.sort(natural)) {
        const ext = extname(name).toLowerCase()
        const stem = basename(name, extname(name))
        if (VIDEO_TYPES[ext]) {
            const posterName = files.find((f) => POSTER_TYPES[extname(f).toLowerCase()] && basename(f, extname(f)) === stem)
            videos.push({
                stem,
                file: join(dir, name),
                contentType: VIDEO_TYPES[ext],
                size: statSync(join(dir, name)).size,
                poster: posterName ? { file: join(dir, posterName), contentType: POSTER_TYPES[extname(posterName).toLowerCase()] } : null,
            })
        } else if (!(POSTER_TYPES[ext] && stems.has(stem))) {
            skipped.push(`${join(dir, name)} — не видео`)
        }
    }
    const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort(natural)
    return { videos, folders }
}

// A folder's videos with the deeper folders' after them.
const flatten = (dir) => {
    const { videos, folders } = readFolder(dir)
    return [...videos, ...folders.flatMap((f) => flatten(join(dir, f)))]
}

const lesson = (course, chapter, title, video) => ({
    ...video,
    title,
    chapter,
    // Also the key of an upload a stopped run left outside the course.
    description: chapter ? `${course} · ${chapter}` : course,
})

const plans = []
for (const arg of dirs) {
    const dir = resolve(arg)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`Нет папки ${dir}.`)
    const title = tidy(basename(dir))
    const { videos, folders } = readFolder(dir)
    const vols = []
    const loose = []
    for (const v of videos) {
        if (CLIPS[v.stem]) {
            clips.push({ ...v, ...CLIPS[v.stem] })
            continue
        }
        const vol = /^vol[-_ ]?(\d+)[-_ ](\d+)$/i.exec(v.stem)
        if (vol) vols.push({ v, n: Number(vol[1]), m: Number(vol[2]) })
        else loose.push(v)
    }
    vols.sort((a, b) => a.n - b.n || a.m - b.m)
    const chaptered = vols.length > 0 || folders.length > 0
    const lessons = [
        ...vols.map(({ v, n, m }) => lesson(title, `Том ${n}`, `Часть ${m}`, v)),
        ...loose.map((v) => lesson(title, chaptered ? LOOSE_CHAPTER : null, tidy(v.stem), v)),
        ...folders.flatMap((f) => flatten(join(dir, f)).map((v) => lesson(title, tidy(f), tidy(v.stem), v))),
    ]
    if (lessons.length === 0) continue
    const seen = new Set()
    const unique = lessons.filter((l) => {
        const key = `${l.chapter}\u0000${l.title}`
        if (seen.has(key)) skipped.push(`${l.file} — урок «${l.title}» уже есть в главе`)
        return !seen.has(key) && seen.add(key)
    })
    plans.push({ title, lessons: unique, chapters: [...new Set(unique.map((l) => l.chapter).filter(Boolean))] })
}
for (const line of skipped) console.log(`• Пропускаю: ${line}`)
if (plans.length === 0 && clips.length === 0) fail('В папках нет видео.')

// ---- API (as demo-videos.mjs) -----------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const request = async (url, init) => {
    try {
        return await fetch(url, init)
    } catch {
        fail(`API не отвечает на ${API}.`)
    }
}

const post = (path, body) =>
    request(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// The demo accounts take the fixed code, but only while a requested code is
// pending: request one first; a throttled request is waited out.
const signIn = async (email) => {
    const deadline = Date.now() + 3 * 60 * 1000
    for (;;) {
        const requested = await post('/send-auth-code', { email, language: 'RU' })
        const signedIn = await post('/sign-in', { email, code: CODE })
        if (signedIn.ok) return (await signedIn.json()).accessToken
        if (requested.ok || Date.now() > deadline) fail(`Не удалось войти как ${email}: ${signedIn.status} ${await signedIn.text()}`)
        console.log('• Вход: код только что запрашивали — жду…')
        await sleep(15_000)
    }
}

// One sign-in per account, again when the access token runs out mid-run.
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
                headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` },
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
    if (!response.ok) fail(`Хранилище отклонило загрузку ${file} (${response.status}): проверьте S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY в .env.`)
}

const started = Date.now()
const api = await account(OWNER)
const { data: workspaces } = await api('POST', '/get-my-workspaces', { perPage: 100 })
const ws = workspaces.find((w) => w.key === CLUB_KEY)?.workspaceId
if (!ws) fail(`У ${OWNER} нет клуба ${CLUB_KEY} — сначала npm run demo:reset.`)

const listLibrary = async () => {
    const all = []
    for (let page = 1; ; page++) {
        const { data, total } = await api('GET', `/admin/videos?workspaceId=${ws}&perPage=100&curPage=${page}`)
        all.push(...data)
        if (data.length === 0 || all.length >= total) return all
    }
}
const library = await listLibrary()
// uploading → uploaded (queued) → processing → ready | failed: a video that
// never finished uploading or failed is redone, the rest are kept or awaited.
const alive = (v) => v.status !== 'uploading' && v.status !== 'failed'
const removeVideos = async (ids) => {
    if (ids.length > 0) await api('POST', '/admin/videos/bulk', { workspaceId: ws, videoIds: ids, action: 'delete' })
}

const coursePath = (id) => `/workspaces/${ws}/playlists/${id}`
const { data: courseList } = await api('GET', `/workspaces/${ws}/playlists?perPage=100`)
const details = new Map()
for (const c of courseList) details.set(c.id, await api('GET', coursePath(c.id)))

// ---- uploads ----------------------------------------------------------------

// create-upload → poster (before the worker draws its own) → PUT → complete.
const upload = async ({ title, description, file, contentType, size, poster }) => {
    const created = await api('POST', '/admin/videos', { workspaceId: ws, title, description, contentType, sizeBytes: size })
    if (poster) {
        const thumb = await api('POST', `/admin/videos/${created.videoId}/thumbnail-upload`, { workspaceId: ws, contentType: poster.contentType })
        await put(thumb.upload.url, poster.file, poster.contentType)
        await api('PATCH', `/admin/videos/${created.videoId}`, { workspaceId: ws, thumbnailUrl: thumb.publicUrl })
    }
    await put(created.upload.url, file, contentType)
    await api('POST', `/admin/videos/${created.videoId}/complete-upload`, { workspaceId: ws })
    return created.videoId
}

const jobs = []
const waiting = []

// ---- presentation clips -----------------------------------------------------

// Each clip takes its lesson's place: same course, chapter and position, the
// generated clip goes once the real one plays. A clip whose lesson already
// plays a file of its length is done; a run stopped half-way left the real one
// as the newest of the matches.
const replacements = []
const clipsCourse = []
const created = new Map(library.map((v) => [v.id, v.createdAt]))
const targets = [...courseList]
    .filter((c) => c.title !== CLIPS_COURSE && !plans.some((p) => p.title === c.title))
    .sort((a, b) => (b.title === AUDIENCE_FROM) - (a.title === AUDIENCE_FROM) || a.slug.localeCompare(b.slug))
for (const clip of clips) {
    const course = targets.find((c) => details.get(c.id).videos.some((v) => clip.lesson.test(v.title)))
    if (!course) {
        clipsCourse.push(lesson(CLIPS_COURSE, null, clip.title, clip))
        continue
    }
    const matches = details.get(course.id).videos.filter((v) => clip.lesson.test(v.title))
    const length = probeDuration(clip.file)
    const [only] = matches
    if (matches.length === 1 && only.status === 'ready' && length !== null && Math.abs((only.duration ?? 0) - length) <= 1) {
        console.log(`• «${course.title}» · «${only.title}» уже с настоящим роликом — пропускаю`)
        continue
    }
    let mine = matches.length > 1 ? [...matches].sort((a, b) => (created.get(b.id) ?? '').localeCompare(created.get(a.id) ?? ''))[0] : null
    if (mine && !alive(mine)) {
        await removeVideos([mine.id])
        mine = null
    }
    const old = matches.filter((v) => v !== mine)
    // An upload a stopped run left outside the course: picked up, or gone.
    const left = mine ? null : library.find((v) => v.playlists.length === 0 && v.title === old[0].title)
    if (left && !alive(left)) await removeVideos([left.id])
    const reuse = left && alive(left) ? left.id : null
    const r = { clip, course, old, attached: Boolean(mine), videoId: mine?.id ?? reuse, label: `«${course.title}» · «${old[0].title}»` }
    replacements.push(r)
    if (!r.videoId) {
        jobs.push({
            label: r.label,
            size: clip.size,
            run: async () => (r.videoId = await upload({ ...clip, title: old[0].title, description: old[0].description ?? undefined })),
        })
    }
    waiting.push({ label: r.label, id: () => r.videoId })
}
if (clipsCourse.length > 0) plans.push({ title: CLIPS_COURSE, lessons: clipsCourse, chapters: [] })

// ---- courses ----------------------------------------------------------------

const audience = await (async () => {
    const from = courseList.find((c) => c.title === AUDIENCE_FROM)
    if (!from) return { groupIds: [], directionIds: [], rankLevelIds: [], planIds: [] }
    const a = await api('GET', `${coursePath(from.id)}/audience`)
    return { groupIds: a.groupIds, directionIds: a.directionIds, rankLevelIds: a.rankLevelIds, planIds: a.planIds }
})()
const slugs = new Set(courseList.map((c) => c.slug))

const courses = []
for (const plan of plans) {
    let summary = courseList.find((c) => c.title === plan.title)
    if (!summary) {
        let slug = slugify(plan.title)
        for (let i = 2; slugs.has(slug); i++) slug = `${slugify(plan.title)}-${i}`
        slugs.add(slug)
        summary = await api('POST', `/workspaces/${ws}/playlists`, {
            title: plan.title,
            slug,
            description: `${plural(plan.lessons.length, 'урок', 'урока', 'уроков')}${plan.chapters.length ? `: ${plan.chapters.join(', ')}` : ''}`,
            level: LEVEL,
            lockedProgression: false,
            isPublic: true,
            publishedAt: null,
        })
        await api('PUT', `${coursePath(summary.id)}/audience`, audience)
        details.set(summary.id, await api('GET', coursePath(summary.id)))
        console.log(`✔ Курс «${plan.title}» создан (черновик до готовности всех уроков)`)
    }
    const path = coursePath(summary.id)
    const course = { ...summary, path, plan, chapterIds: new Map(), lessons: [] }
    courses.push(course)
    const current = details.get(summary.id)
    for (const ch of current.chapters) course.chapterIds.set(ch.title, ch.id)
    for (const title of plan.chapters) {
        if (!course.chapterIds.has(title)) course.chapterIds.set(title, (await api('POST', `${path}/chapters`, { title })).id)
    }

    const inCourse = new Map(current.videos.map((v) => [`${v.chapterTitle}\u0000${v.title}`, v]))
    const broken = []
    for (const l of plan.lessons) {
        const entry = { ...l, videoId: null, fresh: false }
        course.lessons.push(entry)
        const there = inCourse.get(`${l.chapter}\u0000${l.title}`)
        if (there && alive(there)) {
            entry.videoId = there.id
        } else {
            if (there) broken.push(there.id)
            const left = library.find((v) => v.playlists.length === 0 && v.title === l.title && (v.description ?? null) === l.description)
            if (left && alive(left)) {
                entry.videoId = left.id
                entry.fresh = true
            } else {
                if (left) broken.push(left.id)
                entry.fresh = true
                jobs.push({ label: `${l.description} · «${l.title}»`, size: l.size, run: async () => (entry.videoId = await upload(l)) })
            }
        }
        waiting.push({ label: `${l.description} · «${l.title}»`, id: () => entry.videoId, course })
    }
    await removeVideos(broken)
    const reused = plan.lessons.length - course.lessons.filter((e) => e.fresh).length
    console.log(`• «${plan.title}»: уроков ${plan.lessons.length}, уже в курсе ${reused}`)
}

// ---- upload, attach, order --------------------------------------------------

if (jobs.length > 0) {
    const total = jobs.reduce((s, j) => s + j.size, 0)
    console.log(`• Загружаю ${plural(jobs.length, 'ролик', 'ролика', 'роликов')} (${sizeMb(total)}) по ${CONCURRENCY} одновременно…`)
    const from = Date.now()
    let next = 0
    let done = 0
    const width = String(jobs.length).length
    await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
            while (next < jobs.length) {
                const job = jobs[next++]
                const t = Date.now()
                await job.run()
                done++
                console.log(`✔ [${String(done).padStart(width)}/${jobs.length}] загружен ${job.label} — ${sizeMb(job.size)}, ${elapsed(t)}`)
            }
        }),
    )
    console.log(`• Загрузка — ${elapsed(from)}`)
}

// One attach per course in lesson order, a chapter per new lesson, a move only
// for a lesson out of place.
for (const course of courses) {
    const fresh = course.lessons.filter((e) => e.fresh)
    for (let i = 0; i < fresh.length; i += 200) {
        await api('POST', `${course.path}/videos`, { videoIds: fresh.slice(i, i + 200).map((e) => e.videoId) })
    }
    for (const e of fresh) {
        if (e.chapter) await api('PATCH', `${course.path}/videos/${e.videoId}`, { chapterId: course.chapterIds.get(e.chapter) })
    }
    const { videos } = await api('GET', course.path)
    const current = videos.map((v) => v.id)
    const planned = course.lessons.map((e) => e.videoId)
    const desired = [...planned, ...current.filter((id) => !planned.includes(id))]
    for (const [i, id] of desired.entries()) {
        if (current[i] === id) continue
        await api('PATCH', `${course.path}/videos/${id}/position`, { afterId: i === 0 ? null : desired[i - 1] })
        current.splice(current.indexOf(id), 1)
        current.splice(i, 0, id)
    }
}

// A real clip goes into its lesson's chapter right after the generated one,
// so it holds the lesson's place once that is deleted. One at a time: moves
// in the same course must not race.
for (const r of replacements) {
    const path = coursePath(r.course.id)
    const [old] = r.old
    if (!r.attached) {
        await api('POST', `${path}/videos`, { videoIds: [r.videoId] })
        if (old.chapterId) await api('PATCH', `${path}/videos/${r.videoId}`, { chapterId: old.chapterId })
    }
    const ids = (await api('GET', path)).videos.map((v) => v.id)
    if (ids.indexOf(r.videoId) !== ids.indexOf(old.id) + 1) await api('PATCH', `${path}/videos/${r.videoId}/position`, { afterId: old.id })
}

// ---- transcoding ------------------------------------------------------------

const status = async () => new Map((await listLibrary()).map((v) => [v.id, v]))
const ready = new Set()
{
    const from = Date.now()
    let progressAt = Date.now()
    let reported = -1
    const width = String(waiting.length).length
    for (;;) {
        const now = await status()
        for (const w of waiting) {
            const v = now.get(w.id())
            if (!v) fail(`Видео ${w.label} пропало из библиотеки — запустите команду ещё раз.`)
            if (v.status === 'failed') fail(`Видео-воркер не смог обработать ${w.label}: ${v.errorMessage ?? 'ошибка'}. Запустите команду ещё раз — урок загрузится заново.`)
            if (v.status === 'ready' && !ready.has(v.id)) {
                ready.add(v.id)
                progressAt = Date.now()
                if (reported >= 0) console.log(`✔ [${String(ready.size).padStart(width)}/${waiting.length}] готов ${w.label} — ${elapsed(from)} с начала обработки`)
            }
        }
        if (reported < 0 && ready.size < waiting.length) console.log(`• Готовы ${ready.size} из ${waiting.length}, жду видео-воркер…`)
        reported = ready.size
        if (ready.size === waiting.length) break
        if (Date.now() - progressAt > STALL_MS) {
            fail(`За ${elapsed(progressAt)} не обработан ни один ролик. Запущен ли видео-воркер: npx nx serve @clubspace/video-worker?`)
        }
        await sleep(10_000)
    }
}

for (const r of replacements) {
    await removeVideos(r.old.map((v) => v.id))
    console.log(`✔ ${r.label}: настоящий ролик вместо сгенерированного`)
}

for (const course of courses) {
    if (!course.publishedAt) {
        await api('PATCH', course.path, { publishedAt: new Date().toISOString() })
        console.log(`✔ Курс «${course.title}» опубликован`)
    }
}

// «Новое видео» / «Новый курс» on the demo phones, marked read (they stay in
// the inbox) — a run stopped before this point is made good by the next one.
let marked = 0
for (const email of ACCOUNTS) {
    const as = await account(email)
    const ids = []
    for (let page = 1; ; page++) {
        const { data, meta } = await as('GET', `/me/notifications?perPage=100&curPage=${page}`)
        ids.push(...data.filter((n) => !n.seen && NOTICE_KINDS.has(n.metadata?.kind)).map((n) => n.id))
        if (data.length === 0 || page * 100 >= meta.total) break
    }
    if (ids.length > 0) await as('POST', '/me/notifications/seen', { ids })
    marked += ids.length
}
if (marked > 0) console.log(`✔ Уведомления о новых роликах и курсах у демо-аккаунтов отмечены прочитанными (${marked})`)

const lines = courses.map((c) => `«${c.title}» — ${plural(c.lessons.length, 'урок', 'урока', 'уроков')}`)
const swapped = replacements.map((r) => r.label)
console.log(
    `Готово за ${elapsed(started)}: ${[...lines, ...swapped.map((s) => `${s} — настоящий ролик`)].join('; ') || 'всё уже было на месте'}${skipped.length ? `; пропущено файлов: ${skipped.length}` : ''}. В приложении: «Видео».`,
)
