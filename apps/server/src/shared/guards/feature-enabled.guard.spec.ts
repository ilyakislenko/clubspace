import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

jest.mock('../../infrastructure/prisma', () => ({ PrismaService: class {} }))

import { ForbiddenError } from '../errors/shared.errors'
import { FeatureEnabledGuard } from './feature-enabled.guard'

const allOn = {
    announcementsEnabled: true,
    ranksEnabled: true,
    leaderboardEnabled: true,
    attendanceEnabled: true,
    subscriptionEnabled: true,
    scheduleEnabled: true,
    groupsEnabled: true,
    eventsEnabled: true,
    guestVisitsEnabled: true,
    videosEnabled: true,
    achievementsEnabled: true,
    journalEnabled: true,
}

const build = (opts: { key?: string; row?: Record<string, boolean> | null }) => {
    const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue(opts.key),
    }
    const findUnique = jest
        .fn()
        .mockResolvedValue('row' in opts ? opts.row : allOn)
    const guard = new FeatureEnabledGuard(
        reflector as unknown as Reflector,
        { workspace: { findUnique } } as never,
    )
    return { guard, findUnique }
}

const ctx = (request: Record<string, unknown>): ExecutionContext =>
    ({
        getHandler: () => undefined,
        getClass: () => undefined,
        switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext

describe('FeatureEnabledGuard', () => {
    it('lets a route without @RequiresFeature through without a query', async () => {
        const { guard, findUnique } = build({ key: undefined })
        await expect(
            guard.canActivate(ctx({ params: { workspaceId: 'w1' } })),
        ).resolves.toBe(true)
        expect(findUnique).not.toHaveBeenCalled()
    })

    it('passes when the section is on', async () => {
        const { guard } = build({ key: 'journal' })
        await expect(
            guard.canActivate(ctx({ params: { workspaceId: 'w1' } })),
        ).resolves.toBe(true)
    })

    it('refuses when the section is off', async () => {
        const { guard } = build({
            key: 'journal',
            row: { ...allOn, journalEnabled: false },
        })
        await expect(
            guard.canActivate(ctx({ params: { workspaceId: 'w1' } })),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('refuses an unknown workspace', async () => {
        const { guard } = build({ key: 'videos', row: null })
        await expect(
            guard.canActivate(ctx({ params: { workspaceId: 'nope' } })),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })
})
