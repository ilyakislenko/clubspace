// Тренер в приложении: сегодняшняя тренировка → отметить пришедших.
import { academyId, apiSession } from '../lib/api.mjs'
import { config } from '../lib/env.mjs'
import { openPhone } from '../lib/phone.mjs'
import { forget, recall, remember } from '../lib/state.mjs'

const NOTE = 'Отработали проходы в ноги'
const MARKED = 5

// The class the guide marked (slot + day) goes back to unmarked, without a note.
// Only a class that has not happened yet is used, so nobody else marked it.
async function restore(api, ws, { slotId, sessionDate }) {
    const { data } = await api.get(`/workspaces/${ws}/attendance/sessions?from=${sessionDate}&to=${sessionDate}&perPage=100`)
    const session = data.find((s) => s.slotId === slotId)
    if (session) {
        const base = `/workspaces/${ws}/attendance/sessions/${session.id}`
        const { roster } = await api.get(`${base}/roster`)
        for (const e of roster.filter((e) => e.present)) await api.del(`${base}/records/${e.userId}`)
        await api.patch(base, { notes: null })
    }
}

export default {
    id: 'attendance',
    role: 'Тренер',
    title: 'Отметить посещения в приложении',
    kind: 'phone',
    outro: 'Посещения и остаток занятий сразу видны в клубе',
    async record() {
        const api = await apiSession(config.accounts.coach)
        const ws = await academyId(api)
        const left = recall(this.id)
        if (left) await restore(api, ws, left)
        forget(this.id)

        const rec = await openPhone({ id: this.id, email: config.accounts.coach, url: `${config.pwaUrl}/` })
        const p = rec.page
        // «Сегодня вы ведёте»: the coach's classes today that have not ended.
        const nextClass = p.getByRole('button', { name: /^Открыть: \d{1,2}:\d{2}/ }).first()
        await nextClass.waitFor({ timeout: 30_000 })
        await rec.pause(1000)
        rec.begin()

        await rec.say('Ваши тренировки на сегодня — сразу на главной', { hold: 2400 })
        await rec.moveTo(nextClass)
        await rec.pause(1800)
        await rec.click(nextClass, { after: 2200 })
        const [, slotId, sessionDate] = new URL(p.url()).pathname.match(/\/attendance\/([^/]+)\/(\d{4}-\d{2}-\d{2})/)
        remember(this.id, { slotId, sessionDate })

        await rec.say('Назовите группе код — ученики отметятся сами', { hold: 1200 })
        await rec.moveTo(p.getByText(/^Код самоотметки/))
        await rec.pause(3400)

        await rec.say('Или отметьте сами: нажмите на имя пришедшего', { hold: 1400 })
        const rows = p.getByRole('checkbox')
        for (let i = 0; i < MARKED; i++) {
            await rec.click(rows.nth(i), { after: 900 })
            if (i === 2) rec.markPoster()
        }
        await rec.pause(1200)
        await rec.say('Ошиблись — нажмите ещё раз, и отметка снимется', { hold: 1200 })
        await rec.click(rows.nth(MARKED - 1), { after: 2400 })

        await rec.say('Занятие спишется с абонемента — видно, сколько осталось', { hold: 1200 })
        await rec.moveTo(p.getByText(/занятий · осталось \d+/).first())
        await rec.pause(3400)

        // The card scanner opens shortly before the start and closes after it.
        const scan = p.getByText('Сканировать', { exact: true })
        if (await scan.isVisible().catch(() => false)) {
            await rec.say('Гостя из другой группы отметьте по QR-карте в его приложении', { hold: 1200 })
            await rec.moveTo(scan)
            await rec.pause(3600)
        }

        await rec.say('Оставьте заметку — что отработали на тренировке', { hold: 900 })
        await rec.type(p.getByPlaceholder(/^Например: отработали/), NOTE, { after: 600 })
        await rec.click(p.getByText('Сохранить заметку', { exact: true }), { after: 1800 })

        await rec.say('Отметки сохраняются сразу — даже без интернета', { hold: 1200 })
        await rec.moveTo(p.getByText(/отмечено \d+ из \d+/))
        await rec.pause(3400)
        await rec.click(p.getByRole('link', { name: /back$/ }), { after: 1500 })
        await rec.say('Прошедшие и будущие тренировки — во вкладке «Расписание»', { hold: 600 })
        await rec.click(p.getByText('Расписание', { exact: true }).last(), { after: 3000 })
        // A past class nobody marked yet offers «Отметить посещаемость».
        const late = p.getByText(/^Отметить посещаемость/).first()
        if (await late.isVisible().catch(() => false)) {
            await rec.say('Забыли отметить — откройте прошедшую тренировку здесь', { hold: 300 })
            await rec.moveTo(late)
            await rec.pause(3600)
        }
        const recording = await rec.finish()

        await restore(api, ws, { slotId, sessionDate })
        forget(this.id)
        return recording
    },
}
