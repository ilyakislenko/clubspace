jest.mock('../../environments/environment', () => ({
    environment: { demo: { enabled: false } },
}))
jest.mock('../../infrastructure/prisma', () => ({ PrismaService: class {} }))
jest.mock('../../domains/demo/demo-club.service', () => ({ DemoClubService: class {} }))
jest.mock('../../domains/realtime/realtime-emitter.service', () => ({ RealtimeEmitter: class {} }))
jest.mock('../attendance-leaderboard/leaderboard-cache.service', () => ({
    LeaderboardCacheService: class {},
}))

import { environment } from '../../environments/environment'
import { ForbiddenError } from '../../shared/errors/shared.errors'
import { GetPlatformDemoClubFeature } from './get-platform-demo-club.feature'
import { GetPlatformDemoClubHandler } from './get-platform-demo-club.handler'
import { ResetPlatformDemoClubFeature } from './reset-platform-demo-club.feature'
import { ResetPlatformDemoClubHandler } from './reset-platform-demo-club.handler'

const ON = { enabled: true, workspaceKey: 'academy-demo', code: '730592' }

const buildGet = (demo: { id: string; name: string } | null) => {
    const prisma = {
        workspace: { findFirst: jest.fn().mockResolvedValue(demo) },
        workspaceJoinCode: { findUnique: jest.fn().mockResolvedValue({ code: 'ACADEMY7' }) },
        auditEvent: {
            findFirst: jest.fn().mockResolvedValue({ createdAt: new Date('2026-11-01T08:00:00Z') }),
        },
    }
    return { prisma, handler: new GetPlatformDemoClubHandler(prisma as never) }
}

describe('GetPlatformDemoClubHandler', () => {
    afterEach(() => {
        environment.demo = { enabled: false }
    })

    it('refuses a caller who is not a platform admin', async () => {
        const { handler, prisma } = buildGet(null)
        await expect(handler.execute(new GetPlatformDemoClubFeature('u', false, 'academy'))).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.workspace.findFirst).not.toHaveBeenCalled()
    })

    it('lists the accounts and hides the code while demo mode is off', async () => {
        const { handler } = buildGet(null)
        const res = await handler.execute(new GetPlatformDemoClubFeature('u', true, 'academy'))
        expect(res).toMatchObject({ enabled: false, loginCode: null, workspace: null, workspaceKey: 'academy-demo' })
        expect(res.accounts.map((a) => a.email)).toContain('owner@academy.demo')
        expect(res.accounts.filter((a) => a.email === null).every((a) => a.via === 'parent@academy.demo')).toBe(true)
    })

    it('shows the club, its join code, the last reset and the code when on', async () => {
        environment.demo = ON
        const { handler } = buildGet({ id: 'w-demo', name: 'ACADEMY' })
        const res = await handler.execute(new GetPlatformDemoClubFeature('u', true, 'academy'))
        expect(res).toMatchObject({
            enabled: true,
            loginCode: '730592',
            workspace: { id: 'w-demo', joinCode: 'ACADEMY7' },
            lastResetAt: '2026-11-01T08:00:00.000Z',
        })
    })

    it('shows the studio with its own accounts, children and last reset', async () => {
        environment.demo = ON
        const { handler, prisma } = buildGet({ id: 'w-ritm', name: 'Студия танца «Ритм»' })
        const res = await handler.execute(new GetPlatformDemoClubFeature('u', true, 'ritm'))
        expect(res).toMatchObject({ club: 'ritm', workspaceKey: 'ritm-demo', loginCode: '730592' })
        expect(prisma.workspace.findFirst.mock.calls[0][0].where).toEqual({ key: 'ritm-demo', isDemo: true })
        expect(prisma.auditEvent.findFirst.mock.calls[0][0].where).toEqual({ action: 'workspace.demoReset', targetId: 'w-ritm' })
        const emails = res.accounts.map((a) => a.email)
        expect(emails).toEqual(expect.arrayContaining(['owner@ritm.demo', 'pedagog@ritm.demo', 'student@ritm.demo', 'parent@ritm.demo']))
        expect(emails.some((e) => e?.endsWith('@academy.demo'))).toBe(false)
        const kids = res.accounts.filter((a) => a.email === null)
        expect(kids.map((k) => k.name)).toEqual(['Соня Лебедева', 'Вика Лебедева'])
        expect(kids.every((k) => k.via === 'parent@ritm.demo' && !/пояс/.test(k.summary))).toBe(true)
    })
})

describe('ResetPlatformDemoClubHandler', () => {
    const build = () => {
        const result = { workspaceId: 'w-demo', durationMs: 900, counts: { members: 1, groups: 1, sessions: 1, visits: 1, subscriptions: 1 } }
        const demoClub = { reset: jest.fn().mockResolvedValue(result) }
        const leaderboard = { invalidate: jest.fn().mockResolvedValue(undefined) }
        const realtime = { invalidate: jest.fn() }
        const handler = new ResetPlatformDemoClubHandler(demoClub as never, leaderboard as never, realtime as never)
        return { handler, demoClub, leaderboard, realtime, result }
    }

    it('refuses a caller who is not a platform admin', async () => {
        const { handler, demoClub } = build()
        await expect(handler.execute(new ResetPlatformDemoClubFeature('u', false, 'academy'))).rejects.toBeInstanceOf(ForbiddenError)
        expect(demoClub.reset).not.toHaveBeenCalled()
    })

    it('resets as the caller and tells the phones to refetch', async () => {
        const { handler, demoClub, leaderboard, realtime, result } = build()
        await expect(handler.execute(new ResetPlatformDemoClubFeature('admin-1', true, 'ritm'))).resolves.toEqual(result)
        expect(demoClub.reset).toHaveBeenCalledWith({ club: 'ritm', actorId: 'admin-1' })
        expect(leaderboard.invalidate).toHaveBeenCalledWith('w-demo')
        expect(realtime.invalidate.mock.calls[0][0]).toBe('w-demo')
        expect(realtime.invalidate.mock.calls[0][1]).toContain('leaderboard')
    })
})
