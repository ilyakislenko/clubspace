jest.mock('../../environments/environment', () => ({
    environment: { adminUrl: 'https://admin.example.com/' },
}))

import { autopayConsentLines } from './autopay-consent'
import { AutopayNotificationsService, autopayTermsText } from './autopay-notifications'

const build = (claimed = true) => {
    const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue({ email: 'member@example.com' }) },
        workspace: { findUniqueOrThrow: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }) },
        workspaceMember: { findMany: jest.fn().mockResolvedValue([{ userId: 'admin-1' }]) },
    }
    const producer = { notifyUser: jest.fn().mockResolvedValue(claimed) }
    const notifications = { sendNotification: jest.fn().mockResolvedValue('n-1') }
    const service = new AutopayNotificationsService(
        prisma as never,
        producer as never,
        notifications as never,
    )
    return { service, prisma, producer, notifications }
}

describe('AutopayNotificationsService', () => {
    it('reminds once per anchor with the date, amount and card, push + e-mail', async () => {
        const s = build()
        await s.service.reminder({
            autopayId: 'ap-1',
            anchorId: 'sub-1',
            userId: 'u-1',
            workspaceId: 'ws-1',
            clubName: 'Клуб',
            planName: 'Безлимит',
            amount: 4500,
            currency: 'RUB',
            lower: true,
            cardLast4: '4444',
            dueAt: new Date('2026-12-14T07:00:00Z'),
            now: new Date('2026-12-11T07:40:00Z'),
            tz: 'Europe/Moscow',
        })
        expect(s.producer.notifyUser.mock.calls[0][0]).toMatchObject({
            kind: 'subscription.autopay_reminder',
            refId: 'ap-1:sub-1',
            feature: 'subscription',
            message:
                'Через 3 дня, 14 декабря, клуб «Клуб» спишет 4\u00a0500 ₽ (цена снизилась) за абонемент «Безлимит» с карты •• 4444. Отключить — в «Мой абонемент».',
        })
        expect(s.notifications.sendNotification.mock.calls[0][0]).toMatchObject({
            type: 'EMAIL',
            identity: 'member@example.com',
        })
    })

    it('sends no e-mail when the push was already claimed (a repeated pass)', async () => {
        const s = build(false)
        await s.service.packLow({
            autopayId: 'ap-1',
            anchorId: 'sub-1',
            userId: 'u-1',
            workspaceId: 'ws-1',
            planName: 'Пакет 8',
            amount: 3000,
            currency: 'RUB',
        })
        await s.service.chargeFailed({
            autopayId: 'ap-1',
            paymentId: 'pay-1',
            userId: 'u-1',
            workspaceId: 'ws-1',
            planName: 'Пакет 8',
            amount: 3000,
            currency: 'RUB',
            reasonText: 'на карте недостаточно средств',
            nextAttemptAt: null,
            tz: 'Europe/Moscow',
        })
        expect(s.notifications.sendNotification).not.toHaveBeenCalled()
    })

    it('confirms a cancellation in writing even with the section off', async () => {
        const s = build()
        await s.service.cancelled({
            autopayId: 'ap-1',
            userId: 'u-1',
            workspaceId: 'ws-1',
            planName: 'Безлимит',
            reason: null,
            accessUntil: new Date('2026-12-14T21:00:00Z'),
            tz: 'Europe/Moscow',
        })
        const push = s.producer.notifyUser.mock.calls[0][0]
        expect(push.feature).toBeUndefined()
        expect(push.message).toBe(
            'Автоплатёж по тарифу «Безлимит» отключён. Следующих списаний не будет. Текущий абонемент действует до 15 декабря.',
        )
        expect(s.notifications.sendNotification).toHaveBeenCalled()
    })

    it('alerts the owner and each club admin once, with a link into the admin', async () => {
        const s = build()
        await s.service.staffAlert({
            workspaceId: 'ws-1',
            refId: 'pay-1:declined',
            path: 'retention?tab=renew',
            message: 'Не прошло списание',
        })
        expect(s.producer.notifyUser.mock.calls.map((c) => [c[0].userId, c[0].refId])).toEqual([
            ['owner-1', 'pay-1:declined:owner-1'],
            ['admin-1', 'pay-1:declined:admin-1'],
        ])
        expect(s.producer.notifyUser.mock.calls[0][0]).toMatchObject({
            kind: 'subscription.autopay_staff_alert',
            link: 'https://admin.example.com/workspace/ws-1/retention?tab=renew',
        })
        expect(s.prisma.workspaceMember.findMany.mock.calls[0][0].where).toMatchObject({
            workspaceId: 'ws-1',
            status: 'ACTIVE',
            role: { name: { in: ['admin'] } },
        })
    })

    it('never throws when a notice fails', async () => {
        const s = build()
        s.producer.notifyUser.mockRejectedValue(new Error('push down'))
        await expect(
            s.service.staffAlert({ workspaceId: 'ws-1', refId: 'x', path: 'settings', message: 'm' }),
        ).resolves.toBeUndefined()
    })
})

describe('autopay texts', () => {
    it('describes terms of a term and of a pack', () => {
        expect(autopayTermsText({ amount: 4000, currency: 'RUB', durationDays: 30, classCount: null })).toBe(
            '4\u00a0000 ₽ за 30 дней',
        )
        expect(autopayTermsText({ amount: 3000, currency: 'RUB', durationDays: 31, classCount: 12 })).toBe(
            '3\u00a0000 ₽ за 12 занятий на 31 день',
        )
    })

    it('words the consent with the club, both amounts, timing, the reminder, opting out and the card', () => {
        const lines = autopayConsentLines({
            clubName: 'Клуб',
            planName: 'Безлимит',
            amountNow: 3600,
            renewalAmount: 4500,
            currency: 'RUB',
            classCount: null,
        })
        expect(lines).toEqual([
            'Сейчас спишем 3\u00a0600 ₽.',
            'Дальше клуб «Клуб» будет списывать 4\u00a0500 ₽ с этой карты за каждый следующий абонемент «Безлимит»: за день до окончания срока.',
            'За 3 дня до списания пришлём напоминание.',
            'Отключить автоплатёж можно в любой момент в разделе «Мой абонемент» — следующих списаний не будет.',
            'Если клуб изменит цену или условия тарифа, спишем новую сумму только после вашего подтверждения.',
            'Данные карты хранит ЮKassa, клуб и ClubSpace их не видят.',
        ])
    })

    it('never promises a pack 3 days’ notice: one class left, then 3 days before the term end', () => {
        const lines = autopayConsentLines({
            clubName: 'Студия',
            planName: '8 занятий',
            amountNow: 3000,
            renewalAmount: 3000,
            currency: 'RUB',
            classCount: 8,
        })
        expect(lines[1]).toContain('когда закончатся занятия или срок')
        expect(lines[2]).toBe(
            'Когда останется одно занятие, пришлём напоминание; если занятия не закончатся раньше — ещё и за 3 дня до окончания срока.',
        )
        expect(lines.join(' ')).not.toContain('За 3 дня до списания')
    })
})
