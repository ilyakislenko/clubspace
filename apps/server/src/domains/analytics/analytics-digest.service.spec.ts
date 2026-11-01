jest.mock('../../environments/environment', () => ({
    environment: { adminUrl: 'https://admin.example.com/' },
}))
jest.mock('./analytics-reports', () => ({
    loadChurnReport: jest.fn(),
    loadCohortReport: jest.fn(),
    loadForecastReport: jest.fn(),
    loadOccupancyReport: jest.fn(),
}))

import { Logger } from '@nestjs/common'

import { AnalyticsDigestService, renderDigestHtml } from './analytics-digest.service'
import {
    loadChurnReport,
    loadCohortReport,
    loadForecastReport,
    loadOccupancyReport,
} from './analytics-reports'

// Monday 2 Nov 2026 09:15 in Tomsk.
const MONDAY = new Date('2026-11-02T02:15:00.000Z')

const mockReports = (members: number) => {
    ;(loadChurnReport as jest.Mock).mockResolvedValue({
        computedAt: null,
        entries: [],
        summary: { total: 0, high: 0, medium: 0, moneyAtStake: 0, currency: 'RUB', contactedRecently: 0 },
    })
    ;(loadForecastReport as jest.Mock).mockResolvedValue({
        computedAt: null,
        currency: 'RUB',
        members,
        monthlyRecurring: 100000,
        horizons: [],
        renewal: { clubRate: 0.7, clubSample: 0, scopeRate: null, scopeSample: 0, usesDefault: true },
        highRiskMoney: 0,
        trial: { trials: 0, converted: 0, rate: null, medianDaysToPay: null },
    })
    ;(loadOccupancyReport as jest.Mock).mockResolvedValue({
        computedAt: null,
        weeks: 8,
        slots: [],
        heatmap: [],
        weakest: [],
        strongest: [],
        suggestions: [],
    })
    ;(loadCohortReport as jest.Mock).mockResolvedValue({ computedAt: null, cohorts: [], average: [] })
}

const setup = () => {
    const claims = new Set<string>()
    const prisma = {
        workspace: {
            findMany: jest
                .fn()
                .mockResolvedValueOnce([{ timezone: 'Asia/Tomsk' }, { timezone: 'Europe/Moscow' }])
                .mockResolvedValueOnce([
                    { id: 'ws', name: 'ACADEMY', timezone: 'Asia/Tomsk', ownerId: 'owner' },
                ]),
        },
        workspaceMember: { findMany: jest.fn().mockResolvedValue([{ userId: 'admin' }, { userId: 'off' }]) },
        user: {
            findMany: jest.fn().mockResolvedValue([
                { id: 'owner', email: 'owner@club.ru' },
                { id: 'admin', email: null },
                { id: 'off', email: 'off@club.ru' },
            ]),
        },
        notificationPreferences: { findMany: jest.fn().mockResolvedValue([{ userId: 'off' }]) },
        notificationDispatchLog: {
            create: jest.fn().mockImplementation(async ({ data }: { data: { kind: string; refId: string } }) => {
                const key = `${data.kind}|${data.refId}`
                if (claims.has(key)) throw Object.assign(new Error('dup'), { code: 'P2002' })
                claims.add(key)
            }),
            deleteMany: jest.fn().mockImplementation(async ({ where }: { where: { kind: string; refId: string } }) => {
                claims.delete(`${where.kind}|${where.refId}`)
            }),
        },
    }
    const producer = { notifyUser: jest.fn().mockResolvedValue(true) }
    const notifications = { sendNotification: jest.fn().mockResolvedValue('n1') }
    const service = new AnalyticsDigestService(prisma as never, producer as never, notifications as never)
    return { prisma, producer, notifications, service, claims }
}

describe('AnalyticsDigestService', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    })

    it('sends push + e-mail to the owner and admins, skipping the opted-out', async () => {
        mockReports(12)
        const { service, producer, notifications } = setup()
        expect(await service.run(MONDAY)).toEqual({ workspaces: 1, sent: 2 })
        expect(producer.notifyUser.mock.calls.map((c) => c[0].userId)).toEqual(['owner', 'admin'])
        expect(producer.notifyUser.mock.calls[0][0]).toMatchObject({
            kind: 'analytics.digest',
            refId: 'ws:owner:2026-11-02',
            topic: 'ACADEMY: аналитика за неделю',
            link: 'https://admin.example.com/workspace/ws/analytics',
            workspaceId: 'ws',
        })
        // The admin has no e-mail address: push only.
        expect(notifications.sendNotification).toHaveBeenCalledTimes(1)
        expect(notifications.sendNotification.mock.calls[0][0]).toMatchObject({
            userId: 'owner',
            type: 'EMAIL',
            identity: 'owner@club.ru',
        })
        expect(notifications.sendNotification.mock.calls[0][0].message).toContain(
            'https://admin.example.com/workspace/ws/analytics/cohorts',
        )
    })

    it('runs once per club per week', async () => {
        mockReports(12)
        const { service, prisma, producer } = setup()
        await service.run(MONDAY)
        prisma.workspace.findMany
            .mockResolvedValueOnce([{ timezone: 'Asia/Tomsk' }])
            .mockResolvedValueOnce([{ id: 'ws', name: 'ACADEMY', timezone: 'Asia/Tomsk', ownerId: 'owner' }])
        expect(await service.run(new Date(MONDAY.getTime() + 20 * 60_000))).toEqual({
            workspaces: 0,
            sent: 0,
        })
        expect(producer.notifyUser).toHaveBeenCalledTimes(2)
    })

    it('stays silent outside Monday morning and for clubs without students', async () => {
        mockReports(0)
        const { service, producer, prisma } = setup()
        prisma.workspace.findMany.mockReset().mockResolvedValue([{ timezone: 'Asia/Tomsk' }])
        expect(await service.run(new Date('2026-11-03T02:15:00.000Z'))).toEqual({ workspaces: 0, sent: 0 })

        const quiet = setup()
        expect(await quiet.service.run(MONDAY)).toEqual({ workspaces: 1, sent: 0 })
        expect(producer.notifyUser).not.toHaveBeenCalled()
        expect(quiet.producer.notifyUser).not.toHaveBeenCalled()
    })

    it('releases the club claim when a report fails, so the next run retries', async () => {
        mockReports(12)
        ;(loadForecastReport as jest.Mock).mockRejectedValueOnce(new Error('db down'))
        const { service, claims } = setup()
        expect(await service.run(MONDAY)).toEqual({ workspaces: 1, sent: 0 })
        expect(claims.size).toBe(0)
    })
})

describe('renderDigestHtml', () => {
    it('escapes the copy and omits links without an admin URL', () => {
        const html = renderDigestHtml(
            'Клуб <b>',
            { facts: ['5 > 3'], actions: [{ text: 'Позвоните', path: 'analytics/churn' }] },
            null,
        )
        expect(html).toContain('Клуб &lt;b&gt;')
        expect(html).toContain('<li>5 &gt; 3</li>')
        expect(html).not.toContain('href')
    })
})
