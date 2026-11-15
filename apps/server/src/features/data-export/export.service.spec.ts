import { ExportService } from './export.service'

// Every export reads the club's time zone; payments go through the journal.
const svc = (prisma: object) =>
    new ExportService(
        {
            workspace: {
                findUnique: jest.fn().mockResolvedValue({ timezone: 'UTC' }),
            },
            ...prisma,
        } as never,
        {} as never,
    )

describe('ExportService.membersCsv', () => {
    it('builds a member roster row with contacts, access and pack', async () => {
        const prisma = {
            workspaceMember: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        status: 'ACTIVE',
                        accessUntil: new Date('2026-08-01T00:00:00Z'),
                        createdAt: new Date('2026-01-15T00:00:00Z'),
                        user: {
                            firstname: 'Иван',
                            lastname: 'Петров',
                            email: 'ivan@x',
                        },
                        role: { name: 'user' },
                        subscriptions: [
                            {
                                classesRemaining: 3,
                                classesTotal: 8,
                                plan: { name: '8 занятий' },
                            },
                        ],
                    },
                ]),
            },
        }
        const csv = await svc(prisma).membersCsv('w1')
        expect(csv).toContain('Имя;Email;Роль;Статус;Доступ до')
        expect(csv).toContain(
            'Иван Петров;ivan@x;user;ACTIVE;2026-08-01;8 занятий;3;8;2026-01-15',
        )
    })

    it('leaves sub/access columns empty for a member without a pack', async () => {
        const prisma = {
            workspaceMember: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        status: 'INVITED',
                        accessUntil: null,
                        createdAt: new Date('2026-02-01T00:00:00Z'),
                        user: { firstname: null, lastname: null, email: 'x@y' },
                        role: { name: 'user' },
                        subscriptions: [],
                    },
                ]),
            },
        }
        const csv = await svc(prisma).membersCsv('w1')
        expect(csv).toContain('x@y;user;INVITED;;;;;2026-02-01')
    })
})

describe('ExportService.attendanceCsv', () => {
    it('builds a check-in row with session, group and member', async () => {
        const prisma = {
            attendanceRecord: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        markedAt: new Date('2026-07-10T18:05:00Z'),
                        isGuest: false,
                        user: {
                            firstname: 'Иван',
                            lastname: 'Петров',
                            email: 'ivan@x',
                        },
                        session: {
                            title: 'Вечерняя',
                            startAt: new Date('2026-07-10T18:00:00Z'),
                            group: { name: 'Взрослые' },
                        },
                    },
                ]),
            },
        }
        const csv = await svc(prisma).attendanceCsv('w1')
        expect(csv).toContain('Дата;Занятие;Группа;Участник;Email;Гость')
        expect(csv).toContain(
            '2026-07-10;Вечерняя;Взрослые;Иван Петров;ivan@x;',
        )
    })

    it('marks guests and tolerates a group-less session', async () => {
        const prisma = {
            attendanceRecord: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        markedAt: new Date('2026-07-11T18:00:00Z'),
                        isGuest: true,
                        user: { firstname: 'Гость', lastname: null, email: 'g@x' },
                        session: {
                            title: 'Семинар',
                            startAt: new Date('2026-07-11T18:00:00Z'),
                            group: null,
                        },
                    },
                ]),
            },
        }
        const csv = await svc(prisma).attendanceCsv('w1')
        expect(csv).toContain('2026-07-11;Семинар;;Гость;g@x;да')
    })
})

describe('ExportService.membersCsv — current abonements', () => {
    const memberRow = (subscriptions: unknown[]) => ({
        createdAt: new Date('2026-01-01T00:00:00Z'),
        accessUntil: null,
        status: 'ACTIVE',
        user: { firstname: 'Иван', lastname: 'Петров', email: 'ivan@x' },
        role: { name: 'user' },
        subscriptions,
    })

    it('reads only live abonements, ending soonest first', async () => {
        const findMany = jest.fn().mockResolvedValue([memberRow([])])
        await svc({ workspaceMember: { findMany } }).membersCsv('w1')
        const { subscriptions } = findMany.mock.calls[0][0].select
        expect(subscriptions.where).toEqual({
            NOT: { workspaceMemberId: null },
            status: 'ACTIVE',
            OR: [{ endDate: null }, { endDate: { gt: expect.any(Date) } }],
        })
        expect(subscriptions.orderBy).toEqual([
            { endDate: { sort: 'asc', nulls: 'last' } },
            { createdAt: 'asc' },
        ])
    })

    it('puts several current abonements in one row, «; »-joined column by column', async () => {
        const findMany = jest.fn().mockResolvedValue([
            memberRow([
                { classesRemaining: 3, classesTotal: 12, plan: { name: 'БЖЖ 12' } },
                { classesRemaining: null, classesTotal: null, plan: { name: 'Тайский безлимит' } },
            ]),
        ])
        const csv = await svc({ workspaceMember: { findMany } }).membersCsv('w1')
        expect(csv).toContain(
            'Иван Петров;ivan@x;user;ACTIVE;;"БЖЖ 12; Тайский безлимит";"3; ";"12; ";2026-01-01',
        )
    })
})

type ExportPrisma = {
    workspace: { findUnique: jest.Mock }
    subscription: { findMany: jest.Mock; fields: { listPrice: string } }
    eventRegistration: { findMany: jest.Mock; fields: { listPrice: string } }
    refund: { findMany: jest.Mock }
    user: { findMany: jest.Mock }
    workspaceMember: { findMany: jest.Mock }
    group: { findFirst: jest.Mock; findMany: jest.Mock }
}

describe('ExportService.paymentsCsv', () => {
    const ADMIN = { workspaceId: 'w1', invokerUserId: 'a-1', roleName: 'admin', isSuperAdmin: false }
    const rbac = {
        resolveCoachScope: jest.fn(async () => ({ scope: 'admin', userId: 'a-1', workspaceId: 'w1', workspaceOwnerId: 'o-1' })),
        canWriteAllGroups: jest.fn(() => true),
    }
    const person = { firstname: 'Иван', lastname: 'Петров', email: 'ivan@x' }
    const sub = (id: string, paidAt: string, over: Record<string, unknown> = {}) => ({
        id,
        paidAt: new Date(paidAt),
        createdAt: new Date('2026-06-01T00:00:00Z'),
        amountPaid: 5000,
        currency: 'RUB',
        paymentMethod: 'CASH',
        markedPaidById: 'staff-1',
        classesTotal: 8,
        userId: 'u1',
        plan: { name: '8 занятий' },
        user: person,
        workspaceMember: { userId: 'u1', user: person },
        payment: null,
        listPrice: null,
        discountId: null,
        discountName: null,
        discountAmount: 0,
        pricedById: null,
        ...over,
    })
    const ticket = (id: string, paidAt: string) => ({
        id,
        paidAt: new Date(paidAt),
        createdAt: new Date('2026-06-01T00:00:00Z'),
        amountPaid: 1500,
        currency: null,
        paymentMethod: 'TRANSFER',
        markedPaidById: null,
        userId: 'u2',
        eventId: 'e1',
        event: { title: 'Мастер-класс', currency: 'RUB' },
        user: { firstname: 'Анна', lastname: null, email: null },
        payments: [],
        listPrice: null,
        discountId: null,
        discountName: null,
        discountAmount: 0,
        pricedById: null,
    })
    const refund = (id: string, refundedAt: string) => ({
        id,
        refundedAt: new Date(refundedAt),
        amount: 1000,
        currency: 'RUB',
        method: 'CASH',
        reason: 'Пропустил две недели',
        createdById: 'staff-1',
        userId: 'u1',
        itemName: '8 занятий',
        user: person,
        subscription: { id: 's1', paidAt: new Date('2026-11-01T10:00:00Z'), createdAt: new Date('2026-06-01T00:00:00Z'), amountPaid: 5000 },
        eventRegistration: null,
        payment: null,
    })
    const prisma = (o: { subs?: unknown[]; tickets?: unknown[]; refunds?: unknown[]; tz?: string } = {}): ExportPrisma => ({
        workspace: { findUnique: jest.fn().mockResolvedValue({ timezone: o.tz ?? 'UTC' }) },
        subscription: {
            findMany: jest.fn().mockResolvedValue(o.subs ?? []),
            fields: { listPrice: 'Subscription.listPrice' },
        },
        eventRegistration: {
            findMany: jest.fn().mockResolvedValue(o.tickets ?? []),
            fields: { listPrice: 'EventRegistration.listPrice' },
        },
        refund: { findMany: jest.fn().mockResolvedValue(o.refunds ?? []) },
        user: {
            findMany: jest.fn().mockResolvedValue([{ id: 'staff-1', firstname: 'Ольга', lastname: 'Админ', email: null }]),
        },
        workspaceMember: { findMany: jest.fn().mockResolvedValue([]) },
        group: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    })
    const exportWith = (p: ExportPrisma) => new ExportService(p as never, rbac as never)

    it('prints every row of the journal view, newest payment first, in the journal’s columns', async () => {
        const p = prisma({
            subs: [
                // Sold 1 000 under the price, nothing named: a one-off by the admin.
                sub('s2', '2026-11-03T10:00:00Z', {
                    paymentMethod: null,
                    markedPaidById: null,
                    classesTotal: null,
                    plan: { name: 'Разовое' },
                    listPrice: 6000,
                    pricedById: 'staff-1',
                }),
                // «Семейная» 500 and a further 500 typed off.
                sub('s1', '2026-11-01T10:00:00Z', {
                    listPrice: 6000,
                    discountId: 'd1',
                    discountName: 'Семейная',
                    discountAmount: 500,
                    pricedById: 'staff-1',
                }),
            ],
            tickets: [ticket('r1', '2026-11-02T10:00:00Z')],
            refunds: [refund('f1', '2026-11-04T10:00:00Z')],
        })
        const { csv } = await exportWith(p).paymentsCsv(ADMIN, { from: '2026-11-01', to: '2026-11-30' })
        const lines = csv.split(/\r?\n/)
        expect(lines[0]).toContain(
            'Дата;Вид;Участник;Email;Тариф / событие;Сумма;Цена по тарифу;Скидка;Название скидки;Дал скидку;Валюта;Способ оплаты;Отметил / вернул;Причина возврата;Источник;Занятий в пакете',
        )
        expect(lines.filter((l) => l.startsWith('2026-'))).toEqual([
            // A refund is negative, with who refunded and why; no discount of its own.
            '2026-11-04;Возврат;Иван Петров;ivan@x;8 занятий;-1000;;;;;RUB;Наличные;Ольга Админ;Пропустил две недели;Абонемент;',
            '2026-11-03;Оплата;Иван Петров;ivan@x;Разовое;5000;6000;1000;Разовая;Ольга Админ;RUB;;;;Абонемент;',
            // A ticket without its own currency is in the event's; recorded before discounts.
            '2026-11-02;Оплата;Анна;;Мастер-класс;1500;;;;;RUB;Перевод;;;Событие;',
            '2026-11-01;Оплата;Иван Петров;ivan@x;8 занятий;5000;6000;1000;Семейная + разовая;Ольга Админ;RUB;Наличные;Ольга Админ;;Абонемент;8',
        ])
    })

    it('reads the sources with the journal’s filters, the period in club-local days', async () => {
        // Novosibirsk is UTC+7: its 3 November runs 2 Nov 17:00Z – 3 Nov 16:59:59.999Z.
        const p = prisma({ tz: 'Asia/Novosibirsk' })
        const out = await exportWith(p).paymentsCsv(ADMIN, {
            from: '2026-11-03',
            to: '2026-11-03',
            method: 'NONE',
            markedById: 'staff-1',
        })
        const nskDay = { gte: new Date('2026-11-02T17:00:00.000Z'), lte: new Date('2026-11-03T16:59:59.999Z') }
        expect(p.subscription.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            isPaid: true,
            paidAt: nskDay,
            paymentMethod: null,
            markedPaidById: 'staff-1',
        })
        expect(p.eventRegistration.findMany.mock.calls[0][0].where).toMatchObject({ paidAt: nskDay, paymentMethod: null })
        // A refund always has a method: «Не указан» has none to read.
        expect(p.refund.findMany).not.toHaveBeenCalled()
        // Unpaged: the file holds the whole view.
        expect(p.subscription.findMany.mock.calls[0][0]).not.toHaveProperty('take')
        expect(out).toMatchObject({ from: '2026-11-03', to: '2026-11-03' })
    })

    it('no dates = the journal’s default, the revenue_30d window', async () => {
        const p = prisma()
        const before = Date.now()
        const out = await exportWith(p).paymentsCsv(ADMIN, {})
        const gte: Date = p.subscription.findMany.mock.calls[0][0].where.paidAt.gte
        expect(before - gte.getTime()).toBeGreaterThanOrEqual(30 * 24 * 3600 * 1000 - 1000)
        expect(out.to).toBe(new Date().toISOString().slice(0, 10))
        expect(out.from).toBe(gte.toISOString().slice(0, 10))
    })

    it('a group of another club is a 404, nothing read', async () => {
        const p = prisma()
        await expect(
            exportWith(p).paymentsCsv(ADMIN, { groupId: '7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d' }),
        ).rejects.toMatchObject({ statusCode: 404 })
        expect(p.subscription.findMany).not.toHaveBeenCalled()
    })

    it('a period the journal refuses is a 400', async () => {
        await expect(exportWith(prisma()).paymentsCsv(ADMIN, { from: '2026-11-03' })).rejects.toMatchObject({
            statusCode: 400,
        })
    })
})

describe('ExportService date-range filters', () => {
    it('attendance filters by session.startAt when a range is given', async () => {
        const findMany = jest.fn().mockResolvedValue([])
        const from = new Date('2026-06-01T00:00:00.000Z')
        await svc({ attendanceRecord: { findMany } }).attendanceCsv('w1', {
            from: '2026-06-01',
        })
        expect(findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { workspaceId: 'w1', session: { startAt: { gte: from } } },
            }),
        )
    })

    // Novosibirsk is UTC+7: its 3 November runs 2 Nov 17:00Z – 3 Nov 16:59:59.999Z.
    const novosibirsk = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Novosibirsk' }),
        },
    }
    const nskDay = {
        gte: new Date('2026-11-02T17:00:00.000Z'),
        lte: new Date('2026-11-03T16:59:59.999Z'),
    }

    it('attendance: a session at 00:30 local is that day — filtered and printed so', async () => {
        const findMany = jest.fn().mockResolvedValue([
            {
                markedAt: new Date('2026-11-02T17:40:00Z'),
                isGuest: false,
                user: { firstname: 'Ольга', lastname: null, email: 'o@x' },
                session: {
                    title: 'High heels',
                    startAt: new Date('2026-11-02T17:30:00Z'),
                    group: null,
                },
            },
        ])
        const csv = await svc({
            ...novosibirsk,
            attendanceRecord: { findMany },
        }).attendanceCsv('w1', { from: '2026-11-03', to: '2026-11-03' })
        expect(findMany.mock.calls[0][0].where.session).toEqual({ startAt: nskDay })
        expect(csv).toContain('2026-11-03;High heels;;Ольга;o@x;')
    })

    it('omits the filter entirely when the range is empty', async () => {
        const findMany = jest.fn().mockResolvedValue([])
        await svc({ attendanceRecord: { findMany } }).attendanceCsv('w1', {})
        expect(findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { workspaceId: 'w1' } }),
        )
    })
})

describe('ExportService.renewalsCsv', () => {
    const DAY = 24 * 3600 * 1000
    const sub = (o: Record<string, unknown> = {}) => ({
        classesRemaining: null,
        classesTotal: null,
        status: 'ACTIVE',
        startDate: new Date(Date.now() - 5 * DAY),
        endDate: new Date(Date.now() + 30 * DAY),
        plan: { name: 'Абонемент' },
        directions: [],
        ...o,
    })

    it('lists only members who are expiring or low on classes, with a reason', async () => {
        const soonAccess = new Date(Date.now() + 2 * DAY)
        const farAccess = new Date(Date.now() + 90 * DAY)
        const findMany = jest.fn().mockResolvedValue([
            {
                userId: 'anna',
                accessUntil: soonAccess,
                user: { firstname: 'Анна', lastname: 'К', email: 'a@x' },
                subscriptions: [],
            },
            {
                userId: 'ivan',
                accessUntil: farAccess,
                user: { firstname: 'Иван', lastname: 'П', email: 'i@x' },
                subscriptions: [
                    sub({ classesRemaining: 0, classesTotal: 8, plan: { name: '8 занятий' } }),
                ],
            },
            {
                userId: 'petr',
                accessUntil: farAccess,
                user: { firstname: 'Пётр', lastname: 'С', email: 'p@x' },
                subscriptions: [sub({ classesRemaining: 5, classesTotal: 8 })],
            },
        ])
        const csv = await svc({ workspaceMember: { findMany } }).renewalsCsv('w1')
        expect(csv).toContain('Причина;Занятий осталось;Занятий всего;Доступ до;Абонемент')
        expect(csv).toContain('Анна К;a@x;Доступ истекает')
        expect(csv).toContain('Иван П;i@x;Занятия закончились;0;8;')
        expect(csv).toContain(';8 занятий')
        // The member with plenty of access + classes is excluded.
        expect(csv).not.toContain('Пётр')
    })

    it('reads the same abonements as the renewal list', async () => {
        const findMany = jest.fn().mockResolvedValue([])
        await svc({ workspaceMember: { findMany } }).renewalsCsv('w1')
        const where = findMany.mock.calls[0][0].select.subscriptions.where
        expect(where.OR[0]).toEqual({
            NOT: { workspaceMemberId: null },
            status: 'ACTIVE',
            OR: [{ endDate: null }, { endDate: { gt: expect.any(Date) } }],
        })
        expect(where.OR[1].status).toEqual({ in: ['ACTIVE', 'EXPIRED'] })
    })

    it('does not call a pending abonement expiring', async () => {
        const findMany = jest.fn().mockResolvedValue([
            {
                userId: 'olga',
                accessUntil: new Date(Date.now() + 2 * DAY),
                user: { firstname: 'Ольга', lastname: 'Н', email: 'o@x' },
                subscriptions: [sub({ startDate: null, endDate: null })],
            },
        ])
        const csv = await svc({ workspaceMember: { findMany } }).renewalsCsv('w1')
        expect(csv).not.toContain('Ольга')
    })

    it('skips a pack renewed ahead with the same scope, keeps another scope ending', async () => {
        const bjj = { direction: { id: 'd-bjj', name: 'БЖЖ', color: null, icon: null } }
        const thai = { direction: { id: 'd-thai', name: 'Тайский', color: null, icon: null } }
        const findMany = jest.fn().mockResolvedValue([
            {
                userId: 'renewed',
                accessUntil: new Date(Date.now() + 60 * DAY),
                user: { firstname: 'Renewed', lastname: null, email: 'r@x' },
                subscriptions: [
                    sub({ classesRemaining: 1, classesTotal: 12, directions: [bjj], endDate: new Date(Date.now() + 2 * DAY) }),
                    sub({ classesRemaining: 12, classesTotal: 12, directions: [bjj], endDate: new Date(Date.now() + 60 * DAY) }),
                ],
            },
            {
                userId: 'other',
                accessUntil: new Date(Date.now() + 60 * DAY),
                user: { firstname: 'Other', lastname: null, email: 'o@x' },
                subscriptions: [
                    sub({ directions: [bjj], endDate: new Date(Date.now() + 2 * DAY), plan: { name: 'БЖЖ месяц' } }),
                    sub({ directions: [thai], endDate: new Date(Date.now() + 60 * DAY) }),
                ],
            },
        ])
        const csv = await svc({ workspaceMember: { findMany } }).renewalsCsv('w1')
        expect(csv).not.toContain('Renewed')
        expect(csv).toContain('Other;o@x;Доступ истекает')
        expect(csv).toContain('БЖЖ месяц')
    })
})
