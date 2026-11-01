import {
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { GetWorkspaceOnboardingFeature } from './get-workspace-onboarding.feature'
import { GetWorkspaceOnboardingHandler } from './get-workspace-onboarding.handler'

const build = (
    o: { denied?: boolean; ws?: unknown; found?: Partial<Record<string, boolean>> } = {},
) => {
    const hit = (key: string) =>
        jest.fn().mockResolvedValue(o.found?.[key] ? { id: key } : null)
    const prisma = {
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue('ws' in o ? o.ws : { ownerId: 'owner' }),
        },
        gym: { findFirst: hit('gym') },
        group: { findFirst: hit('group') },
        groupScheduleSlot: { findFirst: hit('schedule') },
        workspaceMember: { findFirst: hit('members') },
        video: { findFirst: hit('video') },
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
                { key: 'members', done: false },
                { key: 'video', done: false },
            ],
            doneCount: 0,
            total: 5,
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
})
