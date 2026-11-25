import { OrgMetricsCacheService } from './org-metrics-cache.service'

const ROW = {
    workspaceId: 'w1',
    students: 1,
    activeStudents: 1,
    attended30d: 1,
    new30d: 0,
    newcomerRetention3m: { rate: null, eligible: 0 },
    mrr: null,
    revenue30d: null,
}

describe('OrgMetricsCacheService', () => {
    it('computes once and serves the stored snapshot for 10 minutes', async () => {
        const store = new Map<string, string>()
        const redis = {
            get: jest.fn(async (k: string) => store.get(k) ?? null),
            set: jest.fn(async (k: string, v: string) => void store.set(k, v)),
            del: jest.fn(async (k: string) => void store.delete(k)),
        }
        const cache = new OrgMetricsCacheService(redis as never)
        const compute = jest.fn().mockResolvedValue([ROW])
        const first = await cache.getOrCompute('org1', compute)
        const second = await cache.getOrCompute('org1', compute)
        expect(compute).toHaveBeenCalledTimes(1)
        expect(second).toEqual(first)
        expect(redis.set).toHaveBeenCalledWith('org-metrics:org1', expect.any(String), 'PX', 600_000)

        await cache.invalidate('org1')
        await cache.getOrCompute('org1', compute)
        expect(compute).toHaveBeenCalledTimes(2)
    })

    it('a Redis failure only costs the cache', async () => {
        const redis = {
            get: jest.fn().mockRejectedValue(new Error('down')),
            set: jest.fn().mockRejectedValue(new Error('down')),
            del: jest.fn().mockRejectedValue(new Error('down')),
        }
        const cache = new OrgMetricsCacheService(redis as never)
        await expect(cache.getOrCompute('org1', async () => [ROW])).resolves.toMatchObject({ clubs: [ROW] })
        await expect(cache.invalidate('org1')).resolves.toBeUndefined()
    })
})
