import {
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { GetWorkspaceOnboardingFeature } from './get-workspace-onboarding.feature'
import { GetWorkspaceOnboardingHandler } from './get-workspace-onboarding.handler'

const WS = {
    ownerId: 'owner',
    videosEnabled: true,
    scheduleEnabled: true,
    subscriptionEnabled: true,
    // A club on trial: every module is on.
    billing: null,
    moduleEntitlements: [],
}

const build = (
    o: { denied?: boolean; ws?: unknown; found?: Partial<Record<string, boolean>> } = {},
) => {
    const hit = (key: string) =>
        jest.fn().mockResolvedValue(o.found?.[key] ? { id: key } : null)
    const prisma = {
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue(
                    'ws' in o ? o.ws : { ...WS },
                ),
        },
        gym: { findFirst: hit('gym') },
        group: { findFirst: hit('group') },
        groupScheduleSlot: { findFirst: hit('schedule') },
        workspaceMember: { findFirst: hit('members') },
        video: { findFirst: hit('video') },
        plan: { findFirst: hit('plans') },
        workspacePaymentSettings: {
            findUnique: jest
                .fn()
                .mockResolvedValue(o.found?.payments ? { workspaceId: 'w1' } : null),
        },
    }
    const rbac = {
        resolveCoachScope: jest.fn().mockResolvedValue({ scope: 'admin' }),
        canWriteAllGroups: jest.fn().mockReturnValue(!o.denied),
    }
    const handler = new GetWorkspaceOnboardingHandler(
        prisma as never,
        rbac as never,
    )
    return { handler, prisma }
}

const run = (handler: GetWorkspaceOnboardingHandler) =>
    handler.execute(new GetWorkspaceOnboardingFeature('w1', 'u1', 'admin', false))

describe('GetWorkspaceOnboardingHandler', () => {
    it('refuses a coach', async () => {
        const { handler, prisma } = build({ denied: true })
        await expect(run(handler)).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.gym.findFirst).not.toHaveBeenCalled()
    })

    it('404s on a missing club', async () => {
        const { handler } = build({ ws: null })
        await expect(run(handler)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('a brand-new club has every step open, in order', async () => {
        const { handler } = build()
        await expect(run(handler)).resolves.toEqual({
            steps: [
                { key: 'gym', done: false },
                { key: 'group', done: false },
                { key: 'schedule', done: false },
                { key: 'plans', done: false },
                { key: 'members', done: false },
                { key: 'payments', done: false },
                { key: 'video', done: false },
            ],
            doneCount: 0,
            total: 7,
        })
    })

    it('ticks steps from real data; the owner never counts as a member', async () => {
        const { handler, prisma } = build({
            found: { gym: true, group: true, members: true },
        })
        const out = await run(handler)
        expect(out.doneCount).toBe(3)
        expect(out.steps.find((s) => s.key === 'schedule')?.done).toBe(false)
        expect(prisma.workspaceMember.findFirst.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            userId: { not: 'owner' },
            status: { in: ['ACTIVE', 'INVITED'] },
        })
        expect(prisma.video.findFirst.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            status: { not: 'failed' },
        })
    })

    it('ticks abonements from an active tariff and payments from saved keys', async () => {
        const { handler, prisma } = build({ found: { plans: true, payments: true } })
        const out = await run(handler)
        expect(out.steps.filter((s) => s.done).map((s) => s.key)).toEqual([
            'plans',
            'payments',
        ])
        expect(prisma.plan.findFirst.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            isActive: true,
        })
    })

    it('drops abonements and payments when the club has subscriptions switched off', async () => {
        const { handler } = build({ ws: { ...WS, subscriptionEnabled: false } })
        const out = await run(handler)
        expect(out.steps.map((s) => s.key)).toEqual([
            'gym',
            'group',
            'schedule',
            'members',
            'video',
        ])
    })

    it('drops the payments step when the club has no online-payments module', async () => {
        const { handler } = build({
            ws: {
                ...WS,
                billing: { status: 'ACTIVE' },
                moduleEntitlements: [{ mode: 'OFF', compUntil: null, cancelAt: null }],
            },
        })
        const out = await run(handler)
        expect(out.steps.map((s) => s.key)).toEqual([
            'gym',
            'group',
            'schedule',
            'plans',
            'members',
            'video',
        ])
    })

    it('drops the video step when the club has videos switched off', async () => {
        const { handler } = build({
            ws: { ...WS, videosEnabled: false },
            found: { gym: true },
        })
        const out = await run(handler)
        expect(out.steps.map((s) => s.key)).toEqual([
            'gym',
            'group',
            'schedule',
            'plans',
            'members',
            'payments',
        ])
        expect(out).toMatchObject({ doneCount: 1, total: 6 })
    })

    it('drops the schedule step when the club has the schedule switched off', async () => {
        const { handler } = build({
            ws: { ...WS, scheduleEnabled: false },
        })
        const out = await run(handler)
        expect(out.steps.map((s) => s.key)).toEqual([
            'gym',
            'group',
            'plans',
            'members',
            'payments',
            'video',
        ])
    })
})
