// Ученик: поставить приложение со страницы /download, записаться на
// тренировку, посмотреть урок курса.
import { academyId, apiSession } from '../lib/api.mjs'
import { config } from '../lib/env.mjs'
import { openPhone } from '../lib/phone.mjs'
import { forget, recall, remember } from '../lib/state.mjs'

// Another group's class later today: the student books it as a guest.
// Needs to be recorded before it starts (18:00 Tomsk time in the demo club).
const CLASS = 'BJJ Взрослые'
const COURSE = 'БЖЖ: база белого пояса'
const LESSON = 'Двойной проход в ноги'

const cancelBookings = async (api, ws, ids) => {
    for (const id of ids) await api.del(`/workspaces/${ws}/drop-ins/${id}`)
}

export default {
    id: 'student',
    role: 'Ученик',
    title: 'Поставить приложение, записаться, смотреть курс',
    kind: 'phone',
    outro: 'Расписание, записи и видео клуба — в одном приложении',
    async record() {
        const api = await apiSession(config.accounts.student)
        const ws = await academyId(api)
        const left = recall(this.id)
        if (left) await cancelBookings(api, ws, left.bookingIds)
        forget(this.id)
        const before = new Set((await api.get(`/workspaces/${ws}/drop-ins/mine`)).bookings.map((b) => b.id))

        const rec = await openPhone({ id: this.id, email: config.accounts.student, url: `${config.siteUrl}/download` })
        const p = rec.page
        await p.getByText('Скачать для Android').waitFor()
        await rec.pause(800)
        rec.begin()

        await rec.say('Приложение ставится со страницы «Скачать приложение» на сайте', { hold: 1600 })
        await rec.moveTo(p.getByText('Скачать для Android'))
        await rec.pause(2400)
        await rec.say('На iPhone — через Safari: «Поделиться» → «На экран „Домой“»', { hold: 600 })
        await rec.moveTo(p.getByText(/^iPhone и iPad/))
        await rec.pause(3400)

        await rec.say('Войдите по коду из письма — пароль не нужен', { hold: 300 })
        await p.goto(`${config.pwaUrl}/`)
        const nearest = p.getByText('Ближайшая тренировка', { exact: true })
        await nearest.waitFor({ timeout: 30_000 })
        await rec.pause(2200)
        await rec.say('На главной — ближайшая тренировка и остаток абонемента', { hold: 600 })
        await rec.moveTo(nearest)
        await rec.pause(1400)
        await rec.moveTo(p.getByText('Абонемент', { exact: true }).first())
        await rec.pause(1800)

        await rec.say('В «Расписании» — все тренировки клуба', { hold: 300 })
        await rec.click(p.getByText('Расписание', { exact: true }).last(), { after: 2000 })
        await rec.say('Хотите прийти в другую группу — нажмите тренировку и запишитесь', { hold: 600 })
        await rec.click(p.getByText(CLASS, { exact: true }).last(), { after: 2000 })
        await rec.click(p.getByText('Приду на тренировку', { exact: true }), { after: 600 })
        const ids = await rec.offCamera(async () =>
            (await api.get(`/workspaces/${ws}/drop-ins/mine`)).bookings.map((b) => b.id).filter((id) => !before.has(id)),
        )
        remember(this.id, { bookingIds: ids })
        await rec.say('Тренер увидит, что вы придёте', { hold: 2600 })

        await rec.say('Видео клуба — во вкладке «Видео»', { hold: 300 })
        await rec.click(p.getByText('Видео', { exact: true }).last(), { after: 1600 })
        // The first-visit tips card.
        const tips = p.getByText('Закрыть', { exact: true }).last()
        if (await tips.isVisible().catch(() => false)) await rec.click(tips, { after: 600 })
        await rec.click(p.getByText(COURSE, { exact: true }).last(), { after: 2000 })
        await rec.say('Откройте курс и начните с первого урока', { hold: 400 })
        await rec.click(p.getByText(LESSON, { exact: true }).last(), { after: 1500 })
        rec.markPoster()
        await rec.pause(2400)
        await rec.say('Досмотрели — отметьте урок, прогресс курса сохранится', { hold: 600 })
        await rec.moveTo(p.getByText('Просмотрено', { exact: true }).last())
        await rec.pause(3400)
        const recording = await rec.finish()

        await cancelBookings(api, ws, ids)
        forget(this.id)
        return recording
    },
}
