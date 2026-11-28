// Владелец заводит клуб: зал, группа с расписанием на неделю, тариф.
import { choose, navLink, openAdmin } from '../lib/admin.mjs'
import { academyId, apiSession, items } from '../lib/api.mjs'
import { config } from '../lib/env.mjs'

const GYM = 'СК «Старт»'
const GROUP = 'Взрослые · Старт'
const PLAN = 'Старт · 8 занятий'

// A coach and an hour with no other class, so the slot form shows no clash.
const COACH = 'Е. Шадрина'
const TIME = '20:00'

// What a previous run created goes first, so the lists look the same.
async function cleanup(api, ws) {
    for (const g of items(await api.get(`/workspaces/${ws}/groups`)).filter((g) => g.name === GROUP)) {
        await api.del(`/workspaces/${ws}/groups/${g.id}`)
    }
    for (const g of items(await api.get(`/workspaces/${ws}/gyms`)).filter((g) => g.name === GYM)) {
        await api.del(`/workspaces/${ws}/gyms/${g.id}`)
    }
    for (const p of items(await api.get(`/workspaces/${ws}/plans`)).filter((p) => p.name === PLAN)) {
        await api.del(`/workspaces/${ws}/plans/${p.id}`)
    }
}

export default {
    id: 'owner-setup',
    role: 'Владелец клуба',
    title: 'Завести клуб: зал, группа, абонемент',
    kind: 'admin',
    outro: 'Зал, группа с расписанием и тариф готовы — можно звать учеников',
    async record() {
        const api = await apiSession(config.accounts.owner)
        const ws = await academyId(api)
        await cleanup(api, ws)

        const rec = await openAdmin({ id: this.id, email: config.accounts.owner, workspaceId: ws, path: 'groups?tab=gyms' })
        const p = rec.page
        await p.getByRole('button', { name: 'Добавить зал' }).waitFor()
        rec.begin()

        await rec.say('Начните с зала: к нему привязываются группы')
        await rec.click(p.getByRole('button', { name: 'Добавить зал' }))
        await rec.type(p.locator('#gym-name'), GYM)
        await rec.say('Адрес увидят ученики в приложении', { hold: 600 })
        await rec.type(p.locator('#gym-address'), 'Томск, ул. Учебная, 1')
        await rec.click(p.getByRole('dialog').getByRole('button', { name: 'Добавить зал' }), { after: 300 })
        await p.getByRole('dialog').waitFor({ state: 'hidden' })
        await rec.pause(1200)

        await rec.say('Теперь группа, которая занимается в этом зале', { hold: 1200 })
        await rec.click(p.getByRole('tab', { name: /Группы/ }), { after: 700 })
        await rec.click(p.getByRole('button', { name: 'Добавить группу' }))
        await rec.type(p.locator('#group-name'), GROUP)
        const dialog = p.getByRole('dialog')
        await rec.say('Выберите зал и тренера — он будет отмечать посещения', { hold: 800 })
        await choose(rec, dialog.getByRole('combobox').first(), new RegExp(GYM))
        await choose(rec, dialog.getByRole('combobox').nth(1), COACH)
        await rec.say('Направление нужно, чтобы абонементы и отчёты считались по нему', { hold: 800 })
        await choose(rec, dialog.locator('#group-direction'), 'БЖЖ')
        await rec.click(dialog.getByRole('button', { name: 'Создать группу' }), { after: 300 })
        await p.getByRole('link', { name: 'Изменить в расписании' }).waitFor()
        await rec.pause(1500)

        await rec.say('Время тренировок задаётся в расписании', { hold: 1000 })
        await rec.click(p.getByRole('link', { name: 'Изменить в расписании' }), { after: 1500 })
        await rec.click(p.getByRole('button', { name: 'Вперёд' }), { after: 1000 })
        const cell = (day) => p.getByRole('button', { name: `Новая тренировка ${TIME}` }).nth(day)
        // The evening mid-screen: the new slots stay clear of the captions.
        await cell(0).evaluate((el) => el.scrollIntoView({ block: 'center' }))
        await rec.pause(500)
        // Tuesday and Thursday (columns Mon…Sun).
        for (const [day, first] of [[1, true], [3, false]]) {
            if (first) await rec.say('Нажмите на пустую клетку нужного дня и часа', { hold: 900 })
            await rec.click(cell(day), { after: 800 })
            await choose(rec, p.locator('#create-slot-group'), GROUP)
            await rec.type(p.locator('#create-slot-duration'), '90', { after: 300 })
            if (first) await rec.say('«Каждую неделю» — и тренировка повторяется сама', { hold: 900 })
            await rec.click(p.getByLabel(/Каждую неделю/), { after: 500 })
            await rec.click(p.getByRole('button', { name: 'Добавить', exact: true }), { after: 300 })
            await p.getByRole('dialog').waitFor({ state: 'hidden' })
            await rec.pause(1000)
            if (first) await rec.say('Так же добавьте остальные дни недели', { hold: 600 })
        }
        rec.markPoster()
        await rec.pause(1500)

        await rec.say('Осталось завести тариф абонемента', { hold: 900 })
        await rec.click(navLink(rec, 'Абонементы'), { after: 1200 })
        await rec.click(p.getByRole('button', { name: 'Добавить тариф' }), { after: 800 })
        const form = p.getByRole('dialog')
        await rec.type(form.getByPlaceholder('Например, «Безлимит месяц»'), PLAN)
        await rec.say('Цена, срок и число занятий; пусто — безлимит', { hold: 600 })
        await rec.type(form.getByLabel('Цена'), '3500', { after: 300 })
        await rec.type(form.getByLabel('Занятий (пусто — безлимит)'), '8')
        await rec.say('Срок с первой тренировки — честно к новичкам', { hold: 900 })
        await rec.click(form.getByLabel('Срок считается с первой тренировки'), { after: 600 })
        await rec.click(form.getByRole('button', { name: 'Добавить тариф' }), { after: 1500 })
        await rec.say('Готово: тариф продают в карточке ученика', { hold: 3200 })
        return rec.finish()
    },
}
