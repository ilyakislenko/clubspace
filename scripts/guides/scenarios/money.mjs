// Владелец: абонемент в карточке ученика, отметка оплаты, заморозка; затем
// «Удержание» → «Кому позвонить».
import { navLink, openAdmin } from '../lib/admin.mjs'
import { academyId, apiSession, items } from '../lib/api.mjs'
import { config } from '../lib/env.mjs'
import { forget, recall, remember } from '../lib/state.mjs'

const PLAN = '12 занятий'

const subsPath = (ws, userId) => `/workspaces/${ws}/members/${userId}/subscriptions`

// Ends the guide's freeze, takes back the payment mark and cancels the
// abonement it sold. Cancelled abonements stay in the member's history.
async function undo(api, ws, { userId, subscriptionId }) {
    const base = subsPath(ws, userId)
    const subs = await api.get(base)
    for (const f of subs.freezes.filter((f) => f.subscriptionId === subscriptionId && !f.endedEarlyAt)) {
        await api.post(`${base}/${subscriptionId}/freezes/${f.id}/end`)
    }
    const sold = subs.abonements.find((a) => a.id === subscriptionId && a.status === 'ACTIVE')
    if (sold?.isPaid) await api.del(`${base}/${subscriptionId}/payment`)
    if (sold) await api.post(`${base}/${subscriptionId}/cancel`)
}

// An adult from «Кому позвонить» whose abonement ran out and whose history has
// no cancelled abonement — so not one an earlier run used: every run sells to
// someone the card shows as fresh (a demo reset brings them all back).
async function pickMember(api, ws) {
    const atRisk = items(await api.get(`/workspaces/${ws}/at-risk-members`))
    for (const m of atRisk.filter((m) => m.reason === 'lapsed' && m.guardians.length === 0)) {
        const subs = await api.get(subsPath(ws, m.userId))
        if (![...subs.abonements, ...subs.history].some((a) => a.status === 'CANCELLED')) return m
    }
    throw new Error('No lapsed adult left in «Кому позвонить» that a previous run did not use — reset the demo club')
}

const tomskToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tomsk' }).format(new Date())

export default {
    id: 'money',
    role: 'Владелец клуба',
    title: 'Абонементы, оплаты, заморозка и «кому позвонить»',
    kind: 'admin',
    outro: 'Продажи, долги и заморозки — в карточке, а кого вернуть — в «Удержании»',
    async record() {
        const api = await apiSession(config.accounts.owner)
        const ws = await academyId(api)
        const left = recall(this.id)
        if (left) await undo(api, ws, left)
        forget(this.id)
        const member = await pickMember(api, ws)
        const name = `${member.firstname} ${member.lastname}`

        const rec = await openAdmin({ id: this.id, email: config.accounts.owner, workspaceId: ws, path: 'users' })
        const p = rec.page
        const search = p.getByPlaceholder('Поиск по имени, e-mail, телефону или родителю')
        await search.waitFor()
        rec.begin()

        await rec.say('Абонементы продают в карточке ученика', { hold: 1000 })
        await rec.type(search, member.lastname, { after: 1500 })
        await rec.click(p.getByRole('link', { name: new RegExp(name) }).first(), { after: 1800 })

        await rec.say('Срок прошлого абонемента вышел — назначьте новый', { hold: 900 })
        const plan = p.locator('main select').first()
        const planValue = await plan.evaluate((el, prefix) => [...el.options].find((o) => o.text.startsWith(prefix))?.value, `${PLAN} —`)
        await rec.select(plan, planValue, { after: 900 })
        await rec.say('С датой начала абонемент действует сразу, без неё — с первой тренировки', { hold: 600 })
        const start = p.locator('main input[type=date]').first()
        await rec.moveTo(start)
        await start.fill(tomskToday())
        await rec.pause(1400)
        await rec.say('Заплатит позже — снимите «Оплата получена»', { hold: 600 })
        await rec.click(p.getByLabel('Оплата получена'), { after: 900 })
        await rec.click(p.getByRole('button', { name: 'Назначить' }), { after: 1600 })
        const sold = await rec.offCamera(async () => {
            const subs = await api.get(subsPath(ws, member.userId))
            return subs.abonements.find((a) => a.status === 'ACTIVE' && !a.isPaid)
        })
        // Without the sold abonement there is nothing to clean up later and
        // the rest of the take would show the wrong card: stop with a reason.
        if (!sold) throw new Error(`money: no unpaid ACTIVE abonement for ${member.userId} after «Назначить»`)
        remember(this.id, { userId: member.userId, subscriptionId: sold.id })
        await rec.moveTo(p.getByText(/^Ожидает оплаты/))
        await rec.pause(2000)

        await rec.say('Деньги пришли — отметьте оплату и способ', { hold: 600 })
        await rec.click(p.getByRole('button', { name: 'Отметить оплату' }), { after: 900 })
        await rec.click(p.getByRole('radio', { name: 'Перевод' }), { after: 700 })
        await rec.click(p.getByRole('button', { name: 'Подтвердить оплату' }), { after: 1800 })
        rec.markPoster()

        await rec.say('Уезжает или болеет — заморозьте: срок продлится сам', { hold: 600 })
        await rec.click(p.getByRole('button', { name: 'Заморозить' }), { after: 900 })
        await rec.click(p.getByRole('button', { name: '14 дн.' }), { after: 600 })
        await rec.click(p.getByRole('button', { name: 'Отпуск' }), { after: 1400 })
        await rec.click(p.getByRole('button', { name: 'Заморозить' }).last(), { after: 1500 })
        await rec.moveTo(p.getByText(/^Заморожен по/).first())
        await rec.pause(2400)

        await rec.say('Кто может уйти — в «Удержании»: кому позвонить и почему', { hold: 400 })
        await rec.click(navLink(rec, 'Удержание'), { after: 2000 })
        const firstRow = p.locator('tbody tr').first()
        await rec.moveTo(firstRow)
        await rec.pause(2600)
        await rec.say('Позвонили — нажмите «Связались», чтобы не звонить дважды', { hold: 400 })
        await rec.moveTo(firstRow.getByRole('button', { name: 'Связались' }))
        await rec.pause(2800)
        await rec.say('Отберите по причине, залу или группе', { hold: 300 })
        await rec.click(p.getByText(/^Давно не были/).first(), { after: 3200 })
        const recording = await rec.finish()

        await undo(api, ws, { userId: member.userId, subscriptionId: sold.id })
        forget(this.id)
        return recording
    },
}
