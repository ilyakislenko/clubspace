// The card every console action answers with is loaded by one shared helper;
// what matters here is that the action wrote and audited the right thing.
jest.mock('./platform-workspace-billing-view', () => ({
    loadPlatformWorkspaceBilling: jest.fn().mockResolvedValue({ card: true }),
}))

import {
    BadRequestError,
    ForbiddenError,
    ModuleNotEntitledError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { LockPlatformWorkspaceFeatureHandler } from './lock-platform-workspace-feature.handler'
import {
    LockPlatformWorkspaceFeatureFeature,
    LockPlatformWorkspaceFeatureInputSchema,
    UnlockPlatformWorkspaceFeatureFeature,
} from './platform-feature-locks.feature'
import { UnlockPlatformWorkspaceFeatureHandler } from './unlock-platform-workspace-feature.handler'

const flags = {
    announcementsEnabled: true,
    ranksEnabled: true,
    leaderboardEnabled: true,
    attendanceEnabled: true,
    subscriptionEnabled: true,
    scheduleEnabled: true,
    groupsEnabled: true,
    eventsEnabled: true,
    guestVisitsEnabled: true,
    videosEnabled: false,
    achievementsEnabled: true,
    journalEnabled: true,
}

const build = (o: { ws?: unknown; lock?: unknown; updated?: number } = {}) => {
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue('ws' in o ? o.ws : flags),
            update: jest.fn().mockResolvedValue({}),
        },
        workspaceFeatureLock: {
            findFirst: jest.fn().mockResolvedValue(o.lock ?? null),
            updateMany: jest.fn().mockResolvedValue({ count: o.updated ?? 0 }),
            create: jest.fn().mockResolvedValue({}),
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const billing = {}
    const modules = { assertEntitled: jest.fn().mockResolvedValue(undefined) }
    return { prisma, audit, billing, modules }
}

type Deps = ReturnType<typeof build>

const lock = (d: Deps, payload: Record<string, unknown>, isSuperAdmin = true) =>
    new LockPlatformWorkspaceFeatureHandler(
        d.prisma as never,
        d.audit as never,
        d.billing as never,
        d.modules as never,
    ).execute(
        new LockPlatformWorkspaceFeatureFeature('w1', payload as never, 'staff-1', isSuperAdmin),
    )

const unlock = (d: Deps, feature: string, isSuperAdmin = true) =>
    new UnlockPlatformWorkspaceFeatureHandler(
        d.prisma as never,
        d.audit as never,
        d.billing as never,
    ).execute(new UnlockPlatformWorkspaceFeatureFeature('w1', feature, 'staff-1', isSuperAdmin))

describe('LockPlatformWorkspaceFeatureHandler', () => {
    it('refuses anyone but a platform admin', async () => {
        const d = build()
        await expect(lock(d, { feature: 'events', enabled: false }, false)).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(d.prisma.workspaceFeatureLock.create).not.toHaveBeenCalled()
        expect(d.prisma.workspace.update).not.toHaveBeenCalled()
    })

    it('404s on a missing club', async () => {
        const d = build({ ws: null })
        await expect(lock(d, { feature: 'events', enabled: false })).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })

    it('pins the switch, creates the lock through the end of the Moscow day and audits it', async () => {
        const d = build()
        const out = await lock(d, { feature: 'events', enabled: false, until: '2099-03-31' })
        const until = new Date('2099-03-31T20:59:59.999Z')
        expect(d.prisma.workspaceFeatureLock.create).toHaveBeenCalledWith({
            data: { workspaceId: 'w1', feature: 'events', enabled: false, until },
        })
        expect(d.prisma.workspace.update).toHaveBeenCalledWith({
            where: { id: 'w1' },
            data: { eventsEnabled: false },
        })
        expect(d.audit.record.mock.calls[0][0]).toMatchObject({
            action: 'workspace.featureLock',
            workspaceId: 'w1',
            actorId: 'staff-1',
            metadata: {
                feature: 'events',
                from: true,
                to: false,
                until: '2099-03-31',
                previousLock: null,
            },
        })
        expect(out).toEqual({ card: true })
    })

    it('replaces an existing lock instead of creating a second one', async () => {
        const d = build({ lock: { enabled: true, until: null }, updated: 1 })
        await lock(d, { feature: 'events', enabled: false })
        expect(d.prisma.workspaceFeatureLock.updateMany).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', feature: 'events' },
            data: { enabled: false, until: null },
        })
        expect(d.prisma.workspaceFeatureLock.create).not.toHaveBeenCalled()
        expect(d.audit.record.mock.calls[0][0].metadata.previousLock).toEqual({
            enabled: true,
            until: null,
        })
    })

    it('refuses an end date already past', async () => {
        const d = build()
        await expect(
            lock(d, { feature: 'events', enabled: false, until: '2020-01-01' }),
        ).rejects.toBeInstanceOf(BadRequestError)
        expect(d.prisma.workspace.update).not.toHaveBeenCalled()
    })

    it('locks videos on only with the VIDEO module', async () => {
        const d = build()
        d.modules.assertEntitled.mockRejectedValue(
            new ModuleNotEntitledError({ module: 'VIDEO', message: 'нет' }),
        )
        await expect(lock(d, { feature: 'videos', enabled: true })).rejects.toBeInstanceOf(
            ModuleNotEntitledError,
        )
        expect(d.prisma.workspaceFeatureLock.create).not.toHaveBeenCalled()
        await lock(d, { feature: 'videos', enabled: false })
        expect(d.prisma.workspaceFeatureLock.create).toHaveBeenCalled()
    })

    it('rejects an unknown section in the input', () => {
        expect(
            LockPlatformWorkspaceFeatureInputSchema.safeParse({ feature: 'billing', enabled: true })
                .success,
        ).toBe(false)
    })
})

describe('UnlockPlatformWorkspaceFeatureHandler', () => {
    it('refuses anyone but a platform admin', async () => {
        const d = build({ lock: { enabled: false, until: null } })
        await expect(unlock(d, 'events', false)).rejects.toBeInstanceOf(ForbiddenError)
        expect(d.prisma.workspaceFeatureLock.deleteMany).not.toHaveBeenCalled()
    })

    it('rejects an unknown section and 404s when nothing is locked', async () => {
        const d = build()
        await expect(unlock(d, 'billing')).rejects.toBeInstanceOf(BadRequestError)
        await expect(unlock(d, 'events')).rejects.toBeInstanceOf(NotFoundError)
        expect(d.prisma.workspaceFeatureLock.deleteMany).not.toHaveBeenCalled()
    })

    it('404s on a missing club', async () => {
        const d = build({ ws: null })
        await expect(unlock(d, 'events')).rejects.toBeInstanceOf(NotFoundError)
    })

    it('lifts the lock, keeps the switch as it is and audits the lock lifted', async () => {
        const d = build({ lock: { enabled: false, until: null } })
        const out = await unlock(d, 'events')
        expect(d.prisma.workspaceFeatureLock.deleteMany).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', feature: 'events' },
        })
        expect(d.prisma.workspace.update).not.toHaveBeenCalled()
        expect(d.audit.record.mock.calls[0][0]).toMatchObject({
            action: 'workspace.featureUnlock',
            metadata: { feature: 'events', lock: { enabled: false, until: null } },
        })
        expect(out).toEqual({ card: true })
    })
})
