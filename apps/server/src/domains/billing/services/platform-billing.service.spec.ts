const billingEnv = {
    enabled: true,
    trialDays: 14,
    graceDays: 7,
    defaultPlanCode: 'club',
    trialPlanCode: 'club',
    plans: [
        {
            code: 'free',
            name: 'Free',
            priceMonthly: 0,
            currency: 'RUB',
            maxMembers: 30,
            maxCoaches: 2,
            maxStorageGb: 2,
            maxVideos: 10,
            features: [],
            sortOrder: 0,
        },
        {
            code: 'club',
            name: 'Club',
            priceMonthly: 490_000,
            currency: 'RUB',
            maxMembers: 300,
            maxCoaches: null,
            maxStorageGb: 100,
            maxVideos: null,
            features: [],
            sortOrder: 1,
        },
    ],
}
jest.mock('../../../environments/environment', () => ({
    // A getter: jest hoists this factory above the const it reads.
    environment: {
        get billing() {
            return billingEnv
        },
    },
}))

import {
    PlanLimitReachedError,
    UnexpectedError,
} from '../../../shared/errors/shared.errors'
import { PlatformBillingService } from './platform-billing.service'

const p2002 = () => Object.assign(new Error('unique'), { code: 'P2002' })

const plan = (over: Record<string, unknown> = {}) => ({
    id: 'plan-free',
    code: 'free',
    name: 'Free',
    maxMembers: 30,
    maxCoaches: 2,
    maxStorageGb: 2,
    maxVideos: 10,
    ...over,
})

const build = () => {
    const prisma = {
        platformPlan: {
            upsert: jest.fn().mockResolvedValue({}),
            findUnique: jest.fn().mockResolvedValue({ id: 'plan-club' }),
            findMany: jest.fn().mockResolvedValue([plan()]),
        },
        workspaceBilling: {
            findUnique: jest.fn().mockResolvedValue({ plan: plan() }),
            findUniqueOrThrow: jest.fn().mockResolvedValue({ raced: true }),
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockResolvedValue({ created: true, plan: plan() }),
        },
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue({ id: 'w1', ownerId: 'owner' }),
        },
        workspaceMember: {
            groupBy: jest.fn().mockResolvedValue([]),
            findMany: jest.fn().mockResolvedValue([]),
        },
        video: { groupBy: jest.fn().mockResolvedValue([]) },
    }
    const service = new PlatformBillingService(prisma as never)
    return { service, prisma }
}

// groupBy is called members, coaches (workspaceMember) and storage, videos
// (video) in that order.
const withUsage = (
    prisma: ReturnType<typeof build>['prisma'],
    u: { members?: number; coaches?: number; bytes?: number; videos?: number },
) => {
    prisma.workspaceMember.groupBy
        .mockResolvedValueOnce(
            u.members === undefined
                ? []
                : [{ workspaceId: 'w1', _count: { _all: u.members } }],
        )
        .mockResolvedValueOnce(
            u.coaches === undefined
                ? []
                : [{ workspaceId: 'w1', _count: { _all: u.coaches } }],
        )
    prisma.video.groupBy
        .mockResolvedValueOnce(
            u.bytes === undefined
                ? []
                : [{ workspaceId: 'w1', _sum: { sizeBytes: BigInt(u.bytes) } }],
        )
        .mockResolvedValueOnce(
            u.videos === undefined
                ? []
                : [{ workspaceId: 'w1', _count: { _all: u.videos } }],
        )
}

afterEach(() => {
    billingEnv.enabled = true
    billingEnv.defaultPlanCode = 'club'
    billingEnv.trialPlanCode = 'club'
})

describe('PlatformBillingService', () => {
    describe('onModuleInit', () => {
        it('accepts configured plan codes', () => {
            expect(() => build().service.onModuleInit()).not.toThrow()
        })

        it('refuses to boot on a plan code that names nothing', () => {
            billingEnv.trialPlanCode = 'gold'
            expect(() => build().service.onModuleInit()).toThrow(
                'PLATFORM_TRIAL_PLAN="gold"',
            )
        })
    })

    it('upserts every configured plan by code, tolerating a racing insert', async () => {
        const { service, prisma } = build()
        prisma.platformPlan.upsert.mockRejectedValueOnce(p2002())
        await service.onApplicationBootstrap()
        expect(prisma.platformPlan.upsert).toHaveBeenCalledTimes(2)
        expect(prisma.platformPlan.upsert.mock.calls[1][0]).toMatchObject({
            where: { code: 'club' },
            create: { code: 'club', maxMembers: 300, maxCoaches: null },
            update: { name: 'Club', priceMonthly: 490_000 },
        })
    })

    it('never stops the boot when the plan sync fails', async () => {
        const { service, prisma } = build()
        prisma.platformPlan.upsert.mockRejectedValue(new Error('db down'))
        await expect(service.onApplicationBootstrap()).resolves.toBeUndefined()
    })

    it('lists plans, syncing them first on an empty table', async () => {
        const { service, prisma } = build()
        prisma.platformPlan.findMany.mockResolvedValueOnce([])
        await service.listPlans()
        expect(prisma.platformPlan.upsert).toHaveBeenCalled()
        expect(prisma.platformPlan.findMany).toHaveBeenCalledTimes(2)
    })

    describe('getBilling', () => {
        it('returns the existing row', async () => {
            const { service, prisma } = build()
            await expect(service.getBilling('w1')).resolves.toEqual({
                plan: plan(),
            })
            expect(prisma.workspaceBilling.create).not.toHaveBeenCalled()
        })

        it('gives a club that predates billing the default plan, ACTIVE, no expiry', async () => {
            const { service, prisma } = build()
            prisma.workspaceBilling.findUnique.mockResolvedValue(null)
            await service.getBilling('w1')
            expect(prisma.platformPlan.findUnique).toHaveBeenCalledWith({
                where: { code: 'club' },
                select: { id: true },
            })
            expect(prisma.workspaceBilling.create.mock.calls[0][0].data).toEqual({
                workspaceId: 'w1',
                planId: 'plan-club',
                status: 'ACTIVE',
            })
        })

        it('reads the winner when two requests create the row at once', async () => {
            const { service, prisma } = build()
            prisma.workspaceBilling.findUnique.mockResolvedValue(null)
            prisma.workspaceBilling.create.mockRejectedValue(p2002())
            await expect(service.getBilling('w1')).resolves.toEqual({
                raced: true,
            })
        })

        it('syncs the plans when the default plan row is missing', async () => {
            const { service, prisma } = build()
            prisma.workspaceBilling.findUnique.mockResolvedValue(null)
            prisma.platformPlan.findUnique
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ id: 'plan-club' })
            await service.getBilling('w1')
            expect(prisma.platformPlan.upsert).toHaveBeenCalled()
        })

        it('fails loudly when the plan is still missing after a sync', async () => {
            const { service, prisma } = build()
            prisma.workspaceBilling.findUnique.mockResolvedValue(null)
            prisma.platformPlan.findUnique.mockResolvedValue(null)
            await expect(service.getBilling('w1')).rejects.toBeInstanceOf(
                UnexpectedError,
            )
        })
    })

    it('starts a trial on the trial plan for trialDays, owned by the account', async () => {
        const { service } = build()
        const tx = {
            workspaceBilling: { create: jest.fn().mockResolvedValue({}) },
        }
        const now = new Date('2026-11-01T00:00:00.000Z')
        await service.startTrial(tx as never, {
            workspaceId: 'w1',
            ownerId: 'u1',
            now,
        })
        expect(tx.workspaceBilling.create.mock.calls[0][0].data).toEqual({
            workspaceId: 'w1',
            planId: 'plan-club',
            status: 'TRIAL',
            trialEndsAt: new Date('2026-11-15T00:00:00.000Z'),
            trialOwnerId: 'u1',
        })
    })

    it('knows whether an account has used its trial', async () => {
        const { service, prisma } = build()
        prisma.workspaceBilling.findUnique.mockResolvedValueOnce(null)
        await expect(service.hasUsedTrial('u1')).resolves.toBe(false)
        prisma.workspaceBilling.findUnique.mockResolvedValueOnce({ id: 'b1' })
        await expect(service.hasUsedTrial('u1')).resolves.toBe(true)
    })

    describe('usage', () => {
        it('counts per club and takes the owner row back out', async () => {
            const { service, prisma } = build()
            withUsage(prisma, { members: 5, coaches: 3, bytes: 2048, videos: 4 })
            prisma.workspaceMember.findMany.mockResolvedValue([
                { workspaceId: 'w1', role: { name: 'admin' } },
            ])
            await expect(service.getUsage('w1')).resolves.toEqual({
                members: 5,
                coaches: 2,
                storageBytes: 2048,
                videos: 4,
            })
            expect(prisma.workspaceMember.findMany.mock.calls[0][0].where).toEqual({
                status: 'ACTIVE',
                OR: [{ workspaceId: 'w1', userId: 'owner' }],
            })
        })

        it('an owner holding a student row comes off the member count', async () => {
            const { service, prisma } = build()
            withUsage(prisma, { members: 1 })
            prisma.workspaceMember.findMany.mockResolvedValue([
                { workspaceId: 'w1', role: { name: 'user' } },
                { workspaceId: 'other', role: { name: 'user' } },
            ])
            const usage = await service.getUsage('w1')
            expect(usage.members).toBe(0)
        })

        it('is zero for a missing club and for an empty page', async () => {
            const { service, prisma } = build()
            prisma.workspace.findUnique.mockResolvedValue(null)
            await expect(service.getUsage('w1')).resolves.toEqual({
                members: 0,
                coaches: 0,
                storageBytes: 0,
                videos: 0,
            })
            await expect(service.getUsageMany([])).resolves.toEqual(new Map())
            expect(prisma.workspaceMember.groupBy).not.toHaveBeenCalled()
        })
    })

    it('getBillingMany fills in clubs without a row', async () => {
        const { service, prisma } = build()
        prisma.workspaceBilling.findMany.mockResolvedValue([
            { workspaceId: 'w1', plan: plan() },
        ])
        prisma.workspaceBilling.findUnique.mockResolvedValue(null)
        const map = await service.getBillingMany(['w1', 'w2'])
        expect(map.get('w1')).toEqual({ workspaceId: 'w1', plan: plan() })
        expect(map.get('w2')).toEqual({ created: true, plan: plan() })
    })

    describe('assertWithinLimit', () => {
        it('passes without a query when billing is disabled', async () => {
            billingEnv.enabled = false
            const { service, prisma } = build()
            await service.assertWithinLimit('w1', 'members')
            expect(prisma.workspaceBilling.findUnique).not.toHaveBeenCalled()
        })

        it('passes an unlimited dimension without counting', async () => {
            const { service, prisma } = build()
            prisma.workspaceBilling.findUnique.mockResolvedValue({
                plan: plan({ maxMembers: null }),
            })
            await service.assertWithinLimit('w1', 'members')
            expect(prisma.workspaceMember.groupBy).not.toHaveBeenCalled()
        })

        it('passes while there is room', async () => {
            const { service, prisma } = build()
            withUsage(prisma, { members: 29 })
            await expect(
                service.assertWithinLimit('w1', 'members'),
            ).resolves.toBeUndefined()
        })

        it('throws PLAN_LIMIT_REACHED with which limit at the cap', async () => {
            const { service, prisma } = build()
            withUsage(prisma, { members: 30 })
            const err = await service
                .assertWithinLimit('w1', 'members')
                .catch((e) => e)
            expect(err).toBeInstanceOf(PlanLimitReachedError)
            expect(err.statusCode).toBe(403)
            expect(err.metadata).toEqual({
                limit: 'members',
                max: 30,
                used: 30,
                planName: 'Free',
            })
        })

        it('counts the bytes being added against storage', async () => {
            const { service, prisma } = build()
            withUsage(prisma, { bytes: 1024 ** 3 })
            await expect(
                service.assertWithinLimit('w1', 'storage', 1024 ** 3 + 1),
            ).rejects.toBeInstanceOf(PlanLimitReachedError)
        })

        it('ignores a non-positive amount', async () => {
            const { service, prisma } = build()
            await service.assertWithinLimit('w1', 'members', 0)
            expect(prisma.workspaceBilling.findUnique).not.toHaveBeenCalled()
        })
    })

    describe('remaining', () => {
        it('is unlimited when billing is disabled or the dimension has no cap', async () => {
            billingEnv.enabled = false
            const off = build()
            await expect(off.service.remaining('w1', 'members')).resolves.toMatchObject(
                { remaining: null },
            )
            billingEnv.enabled = true
            const { service, prisma } = build()
            prisma.workspaceBilling.findUnique.mockResolvedValue({
                plan: plan({ maxVideos: null }),
            })
            await expect(service.remaining('w1', 'videos')).resolves.toEqual({
                remaining: null,
                planName: 'Free',
                max: null,
                used: 0,
            })
        })

        it('reports the room left with the numbers behind it', async () => {
            const { service, prisma } = build()
            withUsage(prisma, { videos: 7 })
            await expect(service.remaining('w1', 'videos')).resolves.toEqual({
                remaining: 3,
                planName: 'Free',
                max: 10,
                used: 7,
            })
        })
    })
})
