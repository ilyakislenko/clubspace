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

    it('reads the workspace from the query when there is no param', async () => {
        const { guard, findUnique } = build({
            key: 'journal',
            row: { ...allOn, journalEnabled: false },
        })
        await expect(
            guard.canActivate(ctx({ query: { workspaceId: 'w1' } })),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'w1' } }),
        )
    })

    it('fails closed when the route carries no workspaceId', async () => {
        const { guard } = build({ key: 'journal' })
        await expect(guard.canActivate(ctx({}))).rejects.toBeInstanceOf(
            ForbiddenError,
        )
    })

    it.each(['admin', 'head_coach', 'coach'])(
        'lets a %s through when the section is off',
        async (role) => {
            const { guard, findUnique } = build({
                key: 'journal',
                row: { ...allOn, journalEnabled: false },
            })
            await expect(
                guard.canActivate(
                    ctx({
                        params: { workspaceId: 'w1' },
                        user: { isSuperAdmin: false, role: { name: role } },
                    }),
                ),
            ).resolves.toBe(true)
            expect(findUnique).not.toHaveBeenCalled()
        },
    )

    it('lets a platform admin through when the section is off', async () => {
        const { guard } = build({
            key: 'journal',
            row: { ...allOn, journalEnabled: false },
        })
        await expect(
            guard.canActivate(
                ctx({
                    params: { workspaceId: 'w1' },
                    user: { isSuperAdmin: true, role: null },
                }),
            ),
        ).resolves.toBe(true)
    })

    it('still refuses a plain member when the section is off', async () => {
        const { guard } = build({
            key: 'journal',
            row: { ...allOn, journalEnabled: false },
        })
        await expect(
            guard.canActivate(
                ctx({
                    params: { workspaceId: 'w1' },
                    user: { isSuperAdmin: false, role: { name: 'user' } },
                }),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })
})
