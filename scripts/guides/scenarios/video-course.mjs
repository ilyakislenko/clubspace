// Загрузить ролик, собрать из него курс с разделом и опубликовать.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { openAdmin } from '../lib/admin.mjs'
import { academyId, apiSession, items } from '../lib/api.mjs'
import { config } from '../lib/env.mjs'

const VIDEO = 'Уход от удушения сзади'
const COURSE = 'Защита от удушений'
const SLUG = 'zashchita-ot-udusheniy'
const CHAPTER = 'Удушения сзади'

// A 12-second test pattern with a tone (4 MB: one upload request), named
// like the lesson, as a coach's file would be.
function clip() {
    const dir = join(config.workDir, 'video-course')
    const file = join(dir, `${VIDEO}.mp4`)
    if (!existsSync(file)) {
        mkdirSync(dir, { recursive: true })
        execFileSync(config.ffmpeg, [
            '-loglevel', 'error', '-y',
            '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=12',
            '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-c:a', 'aac', '-shortest', file,
        ])
    }
    return file
}

// The course and the video a previous run created.
async function cleanup(api, ws) {
    for (const c of items(await api.get(`/workspaces/${ws}/playlists`)).filter((c) => c.title === COURSE || c.slug === SLUG)) {
        await api.del(`/workspaces/${ws}/playlists/${c.id}`)
    }
    const videos = items(await api.get(`/admin/videos?workspaceId=${ws}&q=${encodeURIComponent(VIDEO)}&perPage=100`))
    for (const v of videos.filter((v) => v.title === VIDEO)) await api.del(`/admin/videos/${v.id}?workspaceId=${ws}`)
}

// The uploaded video, once the worker has processed it (lessons need «Готово»).
async function waitReady(api, ws) {
    for (let i = 0; i < 120; i++) {
        const v = items(await api.get(`/admin/videos?workspaceId=${ws}&q=${encodeURIComponent(VIDEO)}&perPage=100`)).find((v) => v.title === VIDEO)
        if (v?.status === 'ready') return
        if (v?.status === 'failed') throw new Error(`Video processing failed: ${v.errorMessage}`)
        await new Promise((r) => setTimeout(r, 1000))
    }
    throw new Error('The uploaded video is not ready after 2 minutes (is the video worker running?)')
}

export default {
    id: 'video-course',
    role: 'Тренер',
    title: 'Загрузить видео и собрать курс',
    kind: 'admin',
    outro: 'Курс в приложении у учеников — во вкладке «Видео»',
    async record() {
        const api = await apiSession(config.accounts.owner)
        const ws = await academyId(api)
        await cleanup(api, ws)
        const file = clip()

        const rec = await openAdmin({ id: this.id, email: config.accounts.owner, workspaceId: ws, path: 'content' })
        const p = rec.page
        await p.getByRole('button', { name: 'Создать' }).waitFor()
        await rec.pause(800)
        rec.begin()

        await rec.say('Сначала загрузите ролик — подойдёт mp4 с телефона', { hold: 1400 })
        await rec.click(p.getByRole('button', { name: 'Создать' }), { after: 500 })
        await rec.click(p.getByRole('menuitem', { name: 'Загрузить видео' }), { after: 900 })
        const upload = p.getByRole('dialog')
        await rec.moveTo(upload.locator('#video-file'))
        await upload.locator('#video-file').setInputFiles(file)
        await rec.pause(1200)
        await rec.click(upload.getByRole('button', { name: 'Далее' }), { after: 700 })
        await rec.say('Название и описание ученики увидят под видео', { hold: 400 })
        await rec.type(upload.locator('#video-title'), VIDEO, { after: 300 })
        await rec.type(upload.locator('#video-description'), 'Защита шеи и выход на колени', { after: 500 })
        await rec.click(upload.getByRole('button', { name: 'Далее' }), { after: 600 })
        await rec.say('Теги и категории помогут искать — их можно пропустить', { hold: 1600 })
        await rec.click(upload.getByRole('button', { name: 'Далее' }), { after: 1000 })
        await rec.click(upload.getByRole('button', { name: 'Загрузить' }), { after: 300 })
        await upload.getByText('Видео загружено и обрабатывается').waitFor({ timeout: 60_000 })
        await rec.pause(1800)
        await rec.click(upload.getByRole('button', { name: 'Close' }), { after: 600 })

        await rec.say('Пока ролик обрабатывается, заведите курс', { hold: 600 })
        await rec.click(p.getByRole('button', { name: 'Создать' }), { after: 500 })
        await rec.click(p.getByRole('menuitem', { name: 'Новый курс' }), { after: 900 })
        const form = p.getByRole('dialog')
        await rec.type(form.locator('#playlist-title'), COURSE, { after: 300 })
        await rec.say('Адрес — латиницей: по нему курс открывается по ссылке', { hold: 300 })
        await rec.type(form.locator('#playlist-slug'), SLUG, { delay: 45, after: 300 })
        await rec.type(form.locator('#playlist-description'), 'Для белых поясов: защита шеи и выходы', { delay: 45, after: 400 })
        await rec.click(form.getByRole('button', { name: 'Создать курс' }), { after: 300 })
        await form.waitFor({ state: 'hidden' })
        await rec.pause(800)
        await rec.click(p.getByRole('button', { name: 'Курсы', exact: true }), { after: 1000 })
        await rec.click(p.getByText(COURSE, { exact: true }).first(), { after: 1500 })

        await rec.say('Разделы делят курс на темы', { hold: 400, top: true })
        await rec.click(p.getByRole('button', { name: /^Действия/ }), { after: 500 })
        await rec.click(p.getByRole('menuitem', { name: 'Новый раздел' }), { after: 1000 })
        await rec.click(p.getByRole('button', { name: 'Новый раздел', exact: true }), { after: 400 })
        await rec.type(p.getByPlaceholder('Например: Атаки с гарда'), CHAPTER, { after: 300 })
        await rec.click(p.getByRole('button', { name: 'Сохранить', exact: true }), { after: 1000 })

        await rec.offCamera(() => waitReady(api, ws))
        await rec.say('Уроки — это загруженные видео: отметьте нужные', { hold: 400, top: true })
        await rec.click(p.getByRole('button', { name: 'Добавить видео' }), { after: 900 })
        const attach = p.getByRole('dialog')
        await rec.click(attach.getByText(VIDEO, { exact: true }), { after: 700 })
        await rec.click(attach.getByRole('button', { name: 'Добавить', exact: true }), { after: 300 })
        await attach.waitFor({ state: 'hidden' })
        await rec.pause(1000)
        await rec.say('Перетащите урок в раздел', { hold: 300, top: true })
        await rec.drag(p.getByRole('button', { name: 'Перетащить', exact: true }).first(), p.getByText('Перетащите урок в этот раздел.'), { after: 1800 })

        await rec.say('Пока курс — черновик, ученики его не видят. Опубликуйте', { hold: 600 })
        await rec.click(p.getByRole('button', { name: 'Черновик' }), { after: 2200 })
        await rec.say('Кому он доступен — группы, направления, пояса — настраивается здесь', { hold: 300 })
        await rec.moveTo(p.getByText('Доступ к курсу', { exact: true }))
        await rec.pause(3000)

        await rec.click(p.getByRole('link', { name: /Курсы и видео/ }).last(), { after: 800 })
        await rec.click(p.getByRole('button', { name: 'Курсы', exact: true }), { after: 1000 })
        await rec.say('Готовый курс — в списке, а у учеников в приложении', { hold: 300 })
        await rec.moveTo(p.getByText(COURSE, { exact: true }).first())
        rec.markPoster()
        await rec.pause(3200)
        return rec.finish()
    },
}
