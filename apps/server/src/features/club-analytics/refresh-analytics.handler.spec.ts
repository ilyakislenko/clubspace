import { Reflector } from '@nestjs/core'
import { ThrottlerException, ThrottlerStorageService } from '@nestjs/throttler'

import { ForbiddenError } from '../../shared/errors/shared.errors'
import { ClubThrottlerGuard } from '../../shared/guards/club-throttler.guard'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ClubAnalyticsController,
    REFRESH_ANALYTICS_PER_MINUTE,
} from './club-analytics.controller'
import { RefreshAnalyticsFeature } from './refresh-analytics.feature'
import { RefreshAnalyticsHandler } from './refresh-analytics.handler'
import {
    ANALYTICS_FRESH_MS,
    ANALYTICS_REALTIME_RESOURCE,
    AnalyticsRefreshProcessor,
} from './refresh-analytics.processor'

const NOW = new Date('2026-11-14T10:00:00.000Z')
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)
const STALE = minutesAgo(ANALYTICS_FRESH_MS / 60_000 + 1)
const FRESH = minutesAgo(1)

const makePrisma = (run: { historyComputedAt: Date | null; riskComputedAt: Date | null } | null) => ({
    workspace: {
        findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner', coachSeesAllGroups: false }),
    },
    analyticsRun: { findUnique: jest.fn().mockResolvedValue(run) },
})

// BullMQ's rule for a custom job id: while a job with that id exists (waiting
// or running), add() returns it instead of creating another.
const makeQueue = () => {
    const live = new Map<string, { name: string; data: unknown }>()
    const created: string[] = []
    return {
        created,
        finish: (id: string) => live.delete(id),
        add: jest.fn(async (name: string, data: unknown, opts: { jobId: string }) => {
            await Promise.resolve()
            if (!live.has(opts.jobId)) {
                live.set(opts.jobId, { name, data })
                created.push(opts.jobId)
            }
            return live.get(opts.jobId)
        }),
    }
}

type Who = { roleName: string | null; userId: string }
const OWNER: Who = { roleName: null, userId: 'owner' }
const ADMIN: Who = { roleName: 'admin', userId: 'adm' }
const HEAD_COACH: Who = { roleName: 'head_coach', userId: 'hc' }

const setup = (run: Parameters<typeof makePrisma>[0]) => {
    const prisma = makePrisma(run)
    const queue = makeQueue()
    const handler = new RefreshAnalyticsHandler(
        prisma as never,
        new RbacService(prisma as never),
        queue as never,
    )
    const press = (who: Who = ADMIN, workspaceId = 'ws') =>
        handler.execute(new RefreshAnalyticsFeature(workspaceId, who.userId, who.roleName, false))
    return { queue, press }
}

beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
})
afterEach(() => jest.useRealTimers())

describe('RefreshAnalyticsHandler', () => {
    it('refuses a coach and a student without queueing anything', async () => {
        for (const who of [
            { roleName: 'coach', userId: 'c' },
            { roleName: 'user', userId: 'm' },
        ]) {
            const p = setup(null)
            await expect(p.press(who)).rejects.toBeInstanceOf(ForbiddenError)
            expect(p.queue.created).toEqual([])
        }
    })

    it('queues a rebuild for the owner, an admin and a head coach when the snapshots are stale', async () => {
        for (const who of [OWNER, ADMIN, HEAD_COACH]) {
            const p = setup({ historyComputedAt: STALE, riskComputedAt: FRESH })
            await expect(p.press(who)).resolves.toEqual({
                status: 'queued',
                historyComputedAt: STALE.toISOString(),
                riskComputedAt: FRESH.toISOString(),
            })
            expect(p.queue.created).toEqual(['refresh-ws'])
        }
    })

    it('queues the first rebuild of a club that has none', async () => {
        const p = setup(null)
        await expect(p.press()).resolves.toEqual({
            status: 'queued',
            historyComputedAt: null,
            riskComputedAt: null,
        })
        expect(p.queue.created).toEqual(['refresh-ws'])
    })

    it('skips the rebuild while both snapshots are fresh and returns their times', async () => {
        const p = setup({ historyComputedAt: FRESH, riskComputedAt: minutesAgo(4) })
        await expect(p.press()).resolves.toEqual({
            status: 'fresh',
            historyComputedAt: FRESH.toISOString(),
            riskComputedAt: minutesAgo(4).toISOString(),
        })
        expect(p.queue.add).not.toHaveBeenCalled()
    })

    it('starts one job for two concurrent presses, and a new one once it has finished', async () => {
        const p = setup({ historyComputedAt: STALE, riskComputedAt: STALE })
        const [a, b] = await Promise.all([p.press(ADMIN), p.press(HEAD_COACH)])
        expect([a.status, b.status]).toEqual(['queued', 'queued'])
        expect(p.queue.created).toEqual(['refresh-ws'])

        p.queue.finish('refresh-ws')
        await p.press(ADMIN)
        expect(p.queue.created).toEqual(['refresh-ws', 'refresh-ws'])
    })

    it('keeps clubs apart: another club’s rebuild runs alongside', async () => {
        const p = setup({ historyComputedAt: STALE, riskComputedAt: STALE })
        await Promise.all([p.press(OWNER, 'ws'), p.press(OWNER, 'other')])
        expect(p.queue.created).toEqual(['refresh-ws', 'refresh-other'])
    })
})

describe('AnalyticsRefreshProcessor', () => {
    const job = { data: { workspaceId: 'ws' } } as never

    it('rebuilds the club, then tells its pages to reload', async () => {
        const calls: string[] = []
        const snapshots = { refresh: jest.fn(async () => void calls.push('refresh')) }
        const realtime = {
            invalidate: jest.fn((ws: string, r: string[]) => void calls.push(`${ws}:${r.join()}`)),
        }
        await new AnalyticsRefreshProcessor(snapshots as never, realtime as never).process(job)
        expect(snapshots.refresh).toHaveBeenCalledWith('ws')
        expect(calls).toEqual(['refresh', `ws:${ANALYTICS_REALTIME_RESOURCE}`])
    })

    it('still ends the wait on the pages when the rebuild fails', async () => {
        const snapshots = { refresh: jest.fn().mockRejectedValue(new Error('db down')) }
        const realtime = { invalidate: jest.fn() }
        await new AnalyticsRefreshProcessor(snapshots as never, realtime as never).process(job)
        expect(realtime.invalidate).toHaveBeenCalledWith('ws', [ANALYTICS_REALTIME_RESOURCE])
    })
})

describe('POST analytics/refresh throttle', () => {
    const storage = new ThrottlerStorageService()
    afterAll(() => storage.onApplicationShutdown())

    const guardFor = async () => {
        const guard = new ClubThrottlerGuard(
            {
                throttlers: [
                    { name: 'short', ttl: 1_000, limit: 200 },
                    { name: 'default', ttl: 60_000, limit: 5_000 },
                ],
            },
            storage,
            new Reflector(),
        )
        Object.defineProperty(guard, 'tokens', {
            value: { verifyToken: async (t: string) => ({ sub: t }) },
        })
        await guard.onModuleInit()
        return guard
    }
    const ctx = (userId: string) =>
        ({
            getHandler: () => ClubAnalyticsController.prototype.refreshAnalytics,
            getClass: () => ClubAnalyticsController,
            switchToHttp: () => ({
                getRequest: () => ({
                    ip: '203.0.113.7',
                    headers: { authorization: `Bearer ${userId}` },
                }),
                getResponse: () => ({ header: jest.fn() }),
            }),
        }) as never

    it('lets a person press a few times a minute, then answers 429 — per person', async () => {
        const guard = await guardFor()
        for (let i = 0; i < REFRESH_ANALYTICS_PER_MINUTE; i++) {
            await expect(guard.canActivate(ctx('u1'))).resolves.toBe(true)
        }
        await expect(guard.canActivate(ctx('u1'))).rejects.toBeInstanceOf(ThrottlerException)
        // A colleague on the same club Wi-Fi has a bucket of their own.
        await expect(guard.canActivate(ctx('u2'))).resolves.toBe(true)
    })
})
