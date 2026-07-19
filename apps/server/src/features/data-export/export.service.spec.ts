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
})
