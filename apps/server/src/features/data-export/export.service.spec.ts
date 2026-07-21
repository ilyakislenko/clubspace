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
                        subscription: {
                            classesRemaining: 3,
                            classesTotal: 8,
                            plan: { name: '8 занятий' },
                        },
                    },
                ]),
            },
        }
        const csv = await svc(prisma).membersCsv('w1')
        expect(csv).toContain('Имя,Email,Роль,Статус,Доступ до')
        expect(csv).toContain(
            'Иван Петров,ivan@x,user,ACTIVE,2026-08-01,8 занятий,3,8,2026-01-15',
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
                        subscription: null,
                    },
                ]),
            },
        }
        const csv = await svc(prisma).membersCsv('w1')
        expect(csv).toContain('x@y,user,INVITED,,,,,2026-02-01')
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
        expect(csv).toContain('Дата,Занятие,Группа,Участник,Email,Гость')
        expect(csv).toContain(
            '2026-07-10,Вечерняя,Взрослые,Иван Петров,ivan@x,',
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
        expect(csv).toContain('2026-07-11,Семинар,,Гость,g@x,да')
    })
})

describe('ExportService.revenueCsv', () => {
    it('builds a revenue row per purchase', async () => {
        const prisma = {
            subscription: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        startDate: new Date('2026-07-01T00:00:00Z'),
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
        expect(csv).toContain('Дата,Участник,Email,Тариф,Сумма')
        expect(csv).toContain(
            '2026-07-01,Иван Петров,ivan@x,8 занятий,4000,RUB,MANUAL,8',
        )
    })

    it('handles a purchase with no linked member', async () => {
        const prisma = {
            subscription: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        startDate: new Date('2026-06-01T00:00:00Z'),
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
        expect(csv).toContain('2026-06-01,,,Разовое,800,RUB,MANUAL,')
    })

    it('applies a date range to the startDate filter', async () => {
        const findMany = jest.fn().mockResolvedValue([])
        const from = new Date('2026-06-01T00:00:00.000Z')
        const to = new Date('2026-06-30T23:59:59.999Z')
        await svc({ subscription: { findMany } }).revenueCsv('w1', { from, to })
        expect(findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { workspaceId: 'w1', startDate: { gte: from, lte: to } },
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
