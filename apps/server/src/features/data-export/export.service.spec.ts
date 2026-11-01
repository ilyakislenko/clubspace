import { ExportService } from './export.service'

const svc = (prisma: unknown) => new ExportService(prisma as never)

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

describe('ExportService.revenueCsv', () => {
    it('builds a revenue row per purchase', async () => {
        const prisma = {
            subscription: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        createdAt: new Date('2026-07-01T00:00:00Z'),
                        amountPaid: 4000,
                        currency: 'RUB',
                        source: 'MANUAL',
                        classesTotal: 8,
                        plan: { name: '8 занятий' },
                        workspaceMember: {
                            user: {
                                firstname: 'Иван',
                                lastname: 'Петров',
                                email: 'ivan@x',
                            },
                        },
                    },
                ]),
            },
        }
        const csv = await svc(prisma).revenueCsv('w1')
        expect(csv).toContain('Дата оплаты;Участник;Email;Тариф;Сумма')
        expect(csv).toContain(
            '2026-07-01;Иван Петров;ivan@x;8 занятий;4000;RUB;MANUAL;8',
        )
    })

    it('dates a row by its payment, falling back to the sale date, newest first', async () => {
        const row = (createdAt: string, paidAt: string | null, name: string) => ({
            createdAt: new Date(createdAt),
            paidAt: paidAt ? new Date(paidAt) : null,
            amountPaid: 1000,
            currency: 'RUB',
            source: 'MANUAL',
            classesTotal: null,
            plan: { name },
            workspaceMember: null,
        })
        const prisma = {
            subscription: {
                findMany: jest.fn().mockResolvedValue([
                    row('2026-07-01T00:00:00Z', null, 'Старый'),
                    row('2026-06-01T00:00:00Z', '2026-07-09T00:00:00Z', 'Оплачен позже'),
                ]),
            },
        }
        const csv = await svc(prisma).revenueCsv('w1')
        expect(csv.indexOf('2026-07-09;;;Оплачен позже')).toBeGreaterThan(-1)
        expect(csv.indexOf('2026-07-09')).toBeLessThan(csv.indexOf('2026-07-01'))
    })

    it('exports paid rows only', async () => {
        const findMany = jest.fn().mockResolvedValue([])
        await svc({ subscription: { findMany } }).revenueCsv('w1')
        expect(findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            isPaid: true,
        })
    })

    it('handles a purchase with no linked member', async () => {
        const prisma = {
            subscription: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        createdAt: new Date('2026-06-01T00:00:00Z'),
                        amountPaid: 800,
                        currency: 'RUB',
                        source: 'MANUAL',
                        classesTotal: null,
                        plan: { name: 'Разовое' },
                        workspaceMember: null,
                    },
                ]),
            },
        }
        const csv = await svc(prisma).revenueCsv('w1')
        expect(csv).toContain('2026-06-01;;;Разовое;800;RUB;MANUAL;')
    })

    it('applies a date range to the payment date (sale date for legacy rows)', async () => {
        const findMany = jest.fn().mockResolvedValue([])
        const from = new Date('2026-06-01T00:00:00.000Z')
        const to = new Date('2026-06-30T23:59:59.999Z')
        await svc({ subscription: { findMany } }).revenueCsv('w1', { from, to })
        expect(findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    workspaceId: 'w1',
                    isPaid: true,
                    OR: [
                        { paidAt: { gte: from, lte: to } },
                        { paidAt: null, createdAt: { gte: from, lte: to } },
                    ],
                },
            }),
        )
    })
})

describe('ExportService date-range filters', () => {
    it('attendance filters by session.startAt when a range is given', async () => {
        const findMany = jest.fn().mockResolvedValue([])
        const from = new Date('2026-06-01T00:00:00.000Z')
        await svc({ attendanceRecord: { findMany } }).attendanceCsv('w1', {
            from,
        })
        expect(findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { workspaceId: 'w1', session: { startAt: { gte: from } } },
            }),
        )
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
                accessUntil: soonAccess,
                user: { firstname: 'Анна', lastname: 'К', email: 'a@x' },
                subscriptions: [],
            },
            {
                accessUntil: farAccess,
                user: { firstname: 'Иван', lastname: 'П', email: 'i@x' },
                subscriptions: [
                    sub({ classesRemaining: 0, classesTotal: 8, plan: { name: '8 занятий' } }),
                ],
            },
            {
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
            status: 'ACTIVE',
            OR: [{ endDate: null }, { endDate: { gt: expect.any(Date) } }],
        })
        expect(where.OR[1].status).toEqual({ in: ['ACTIVE', 'EXPIRED'] })
    })

    it('does not call a pending abonement expiring', async () => {
        const findMany = jest.fn().mockResolvedValue([
            {
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
                accessUntil: new Date(Date.now() + 60 * DAY),
                user: { firstname: 'Renewed', lastname: null, email: 'r@x' },
                subscriptions: [
                    sub({ classesRemaining: 1, classesTotal: 12, directions: [bjj], endDate: new Date(Date.now() + 2 * DAY) }),
                    sub({ classesRemaining: 12, classesTotal: 12, directions: [bjj], endDate: new Date(Date.now() + 60 * DAY) }),
                ],
            },
            {
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
