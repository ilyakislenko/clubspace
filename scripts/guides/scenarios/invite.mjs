// Позвать учеников: код клуба, ссылка и QR; заявка на вступление принята.
import { navLink, openAdmin } from '../lib/admin.mjs'
import { academyId, apiSession } from '../lib/api.mjs'
import { config } from '../lib/env.mjs'
import { freshJoinRequest } from '../lib/newcomer.mjs'

// The person who asks to join on camera; a previous run's membership is undone.
const NEWCOMER = { email: 'guide.newcomer@example.com', firstname: 'Ирина', lastname: 'Новикова' }

export default {
    id: 'invite',
    role: 'Владелец клуба',
    title: 'Позвать учеников: код, QR и заявки',
    kind: 'admin',
    outro: 'Один код на весь клуб, а кого принять — решаете вы',
    async record() {
        const api = await apiSession(config.accounts.owner)
        const ws = await academyId(api)
        const invite = await api.get(`/workspaces/${ws}/invite`)
        await freshJoinRequest({ ...NEWCOMER, clubCode: invite.joinCode, clubId: ws })

        const rec = await openAdmin({ id: this.id, email: config.accounts.owner, workspaceId: ws, path: 'users' })
        const p = rec.page
        await p.getByRole('button', { name: 'Пригласить' }).waitFor()
        rec.begin()

        await rec.say('Всех учеников зовите одним кодом клуба', { hold: 2600 })
        await rec.click(p.getByRole('button', { name: 'Пригласить' }), { after: 1800 })
        const sheet = p.getByRole('dialog')
        await rec.say('Код, ссылка и QR ведут в один и тот же клуб', { hold: 1800 })
        await rec.moveTo(sheet.locator('svg, img, canvas').last())
        await rec.pause(2500)
        await rec.say('Ссылку отправьте в чат группы или мессенджер', { hold: 1600 })
        await rec.click(sheet.getByRole('button', { name: 'Скопировать ссылку' }), { after: 2200 })
        await rec.say('Плакат с QR-кодом распечатайте для зала', { hold: 1200 })
        await rec.moveTo(sheet.getByRole('button', { name: 'Распечатать плакат' }))
        await rec.pause(2800)
        await rec.say('Без подтверждения выключено: каждую заявку решаете вы', { hold: 1200 })
        await rec.moveTo(sheet.getByRole('switch'))
        await rec.pause(3200)

        // What the link opens: the club's public page with the app links.
        await rec.say('По ссылке ученик видит клуб и ставит приложение', { hold: 300 })
        await rec.page.goto(invite.joinUrl)
        await rec.pause(3500)
        await rec.scroll(500, { after: 2500 })
        await rec.scroll(400, { after: 2500 })
        await rec.page.goBack()
        await p.getByRole('button', { name: 'Пригласить' }).waitFor()
        await rec.pause(800)

        await rec.say('Ученик ввёл код в приложении — пришла заявка', { hold: 1000 })
        await rec.click(p.getByRole('link', { name: /^Заявки/ }), { after: 1500 })
        const row = p.locator('[role=button]', { hasText: `${NEWCOMER.firstname} ${NEWCOMER.lastname}` })
        await rec.moveTo(row)
        await rec.pause(2200)
        await rec.say('Проверьте, кто это, и примите — клуб откроется у него в приложении', { hold: 1800 })
        await rec.click(row.getByRole('button', { name: 'Принять' }), { after: 2500 })

        await rec.say('Новый ученик уже в списке', { hold: 600 })
        await rec.click(navLink(rec, 'Список'), { after: 1000 })
        await rec.type(p.getByPlaceholder('Поиск по имени, e-mail, телефону или родителю'), NEWCOMER.lastname, { after: 1800 })
        rec.markPoster()
        await rec.click(p.getByRole('link', { name: new RegExp(`${NEWCOMER.firstname} ${NEWCOMER.lastname}`) }).first(), { after: 1500 })
        await rec.say('В карточке назначьте абонемент и отметьте оплату', { hold: 1200 })
        await rec.moveTo(p.getByRole('button', { name: 'Назначить' }))
        await rec.pause(3500)
        return rec.finish()
    },
}
