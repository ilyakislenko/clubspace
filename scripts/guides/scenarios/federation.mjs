// Федерация: заявки клубов на турнир; в день турнира — ковры, результат
// схватки, сетка и итоги.
import { openAdmin } from '../lib/admin.mjs'
import { apiSession, items } from '../lib/api.mjs'
import { config } from '../lib/env.mjs'
import { forget, recall, remember } from '../lib/state.mjs'

// The demo federation's tournaments (docs/demo.md, «Демо-федерация»).
const UPCOMING = 'Открытый турнир Томской области'
const RUNNING = 'Кубок федерации, 2-й этап'
const MAT = 2

const undoResult = (api, { orgId, tournamentId, matchId }) =>
    api.post(`/orgs/${orgId}/tournaments/${tournamentId}/matches/${matchId}/undo`)

export default {
    id: 'federation',
    role: 'Федерация',
    title: 'Турнир федерации: заявки, ковры, сетки, итоги',
    kind: 'admin',
    outro: 'Заявки, сетки и итоги турнира — в кабинете федерации',
    async record() {
        const api = await apiSession(config.accounts.federation)
        const left = recall(this.id)
        if (left) await undoResult(api, left).catch(() => {})
        forget(this.id)
        const orgId = items(await api.get('/orgs/mine'))[0].id
        const running = items(await api.get(`/orgs/${orgId}/events`)).find((e) => e.title === RUNNING)
        const tournamentId = (await api.get(`/orgs/${orgId}/events/${running.id}`)).tournament.id
        const match = (await api.get(`/orgs/${orgId}/tournaments/${tournamentId}/mats/${MAT}/queue`)).current
        if (!match) throw new Error(`Nothing to record on mat ${MAT} of «${RUNNING}» (reset the demo club)`)

        const rec = await openAdmin({ id: this.id, email: config.accounts.federation, path: `/org/${orgId}/events` })
        const p = rec.page
        await p.getByText(UPCOMING).first().waitFor()
        rec.begin()

        await rec.say('Турниры федерации — в «Календаре»', { hold: 1600 })
        await rec.click(p.getByText(UPCOMING).first(), { after: 1500 })
        const sheet = p.getByRole('dialog')
        await rec.say('Клубы записывают учеников сами — заявки видны по клубам', { hold: 600 })
        await rec.moveTo(sheet.getByText(/^Записано \d+ из \d+/))
        await rec.pause(1600)
        await rec.moveTo(sheet.getByText('записал тренер').first())
        await rec.pause(2600)
        await rec.click(sheet.getByRole('button', { name: 'Close' }), { after: 800 })

        await rec.say('В день турнира всё ведётся на странице турнира', { hold: 400 })
        await rec.click(p.getByText(RUNNING).first(), { after: 1200 })
        await rec.click(p.getByRole('dialog').getByRole('link', { name: /^Турнир ·/ }), { after: 2000 })
        await rec.say('Категории распределены по коврам, у каждой — своя сетка', { hold: 2600 })
        await rec.say('Взвешивание — вес каждого участника и «в весе»', { hold: 300 })
        await rec.click(p.getByRole('tab', { name: 'Участники' }), { after: 3200 })

        await rec.say('На ковре — текущая схватка и очередь', { hold: 300 })
        await rec.click(p.getByRole('tab', { name: 'Ковры' }), { after: 800 })
        await rec.click(p.getByRole('tab', { name: `Ковёр ${MAT}` }), { after: 2400 })
        await rec.say('Схватка закончилась — запишите победителя и способ', { hold: 300 })
        await rec.click(p.getByRole('button', { name: 'Записать результат' }), { after: 900 })
        const result = p.getByRole('dialog')
        await rec.click(result.getByRole('radio', { name: new RegExp(match.entryA.personName) }), { after: 600 })
        await rec.click(result.getByRole('radio', { name: 'Болевой/удушающий' }), { after: 700 })
        await rec.click(result.getByRole('button', { name: 'Записать' }), { after: 400 })
        remember(this.id, { orgId, tournamentId, matchId: match.id })
        await rec.say('Победитель сам проходит дальше, ошибку можно отменить', { hold: 300 })
        await rec.moveTo(p.getByRole('button', { name: 'Отменить' }))
        await rec.pause(3000)

        await rec.say('Сетка категории обновилась сразу', { hold: 300 })
        await rec.click(p.getByRole('tab', { name: 'Категории' }), { after: 800 })
        await rec.click(p.getByText(match.divisionName, { exact: true }).first(), { after: 1500 })
        rec.markPoster()
        await rec.moveTo(p.getByText(match.entryA.personName).last())
        await rec.pause(3000)

        await rec.say('Итоги видит только федерация, пока вы их не опубликуете', { hold: 300 })
        await rec.click(p.getByRole('link', { name: RUNNING }), { after: 1000 })
        await rec.click(p.getByRole('tab', { name: 'Итоги' }), { after: 3800 })
        const recording = await rec.finish()

        await undoResult(api, { orgId, tournamentId, matchId: match.id })
        forget(this.id)
        return recording
    },
}
