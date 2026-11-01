import { BadRequestError } from '../../shared/errors/shared.errors'
import { buildDemoClubPlan } from './demo-club.plan'
import { writeDemoClubPlan } from './demo-club.writer'

const NOW = new Date('2026-11-04T09:30:00.000Z')
const plan = buildDemoClubPlan({
    now: NOW,
    timezone: 'Europe/Moscow',
    personalDataConsentVersion: '2026-11-01',
    legal: { offerVersion: 'o', dpaVersion: 'd' },
})

type Model = Record<string, jest.Mock>

// A transaction client whose every model records its calls, in order.
const buildTx = (o: { roles?: string[]; taken?: string[]; codeTaken?: boolean } = {}) => {
    const calls: string[] = []
    const models = new Map<string, Model>()
    const model = (name: string): Model => {
        if (!models.has(name)) {
            const m: Model = {
                createMany: jest.fn().mockImplementation(async () => calls.push(`${name}.createMany`)),
                create: jest.fn().mockImplementation(async () => calls.push(`${name}.create`)),
                update: jest.fn().mockResolvedValue({}),
                findMany: jest.fn().mockResolvedValue([]),
                findUnique: jest.fn().mockResolvedValue(null),
            }
            models.set(name, m)
        }
        return models.get(name)!
    }
    model('role').findMany.mockResolvedValue(
        (o.roles ?? ['admin', 'coach', 'user']).map((name) => ({ id: `role-${name}`, name })),
    )
    model('user').findMany.mockResolvedValue((o.taken ?? []).map((email) => ({ email })))
    model('workspaceJoinCode').findUnique.mockResolvedValue(o.codeTaken ? { workspaceId: 'other' } : null)
    const $executeRaw = jest.fn().mockResolvedValue(0)
    const tx = new Proxy({} as Record<string, unknown>, {
        get: (_t, prop: string) => (prop === '$executeRaw' ? $executeRaw : model(prop)),
    })
    return { tx, model, calls, $executeRaw }
}

const run = (tx: unknown, freezes = { createInTx: jest.fn().mockResolvedValue({}) }) =>
    writeDemoClubPlan(tx as never, plan, { freezes: freezes as never, now: NOW }).then(() => freezes)

describe('writeDemoClubPlan', () => {
    it('inserts parents before children and maps member roles', async () => {
        const { tx, model, calls } = buildTx()
        await run(tx)
        const at = (c: string) => calls.indexOf(c)
        expect(at('user.createMany')).toBeLessThan(at('workspace.create'))
        expect(at('workspace.create')).toBeLessThan(at('workspaceMember.createMany'))
        expect(at('group.createMany')).toBeLessThan(at('groupMember.createMany'))
        expect(at('subscription.createMany')).toBeLessThan(at('attendanceRecord.createMany'))
        expect(at('attendanceSession.createMany')).toBeLessThan(at('attendanceRecord.createMany'))
        expect(at('rankLevel.createMany')).toBeLessThan(at('rankPromotion.createMany'))
        expect(at('attendanceSession.createMany')).toBeLessThan(at('personalTrainingRequest.createMany'))

        const members = model('workspaceMember').createMany.mock.calls.flatMap((c) => c[0].data)
        expect(members).toHaveLength(plan.members.length)
        expect(members.every((m: { roleId: string }) => m.roleId.startsWith('role-'))).toBe(true)
        expect(model('user').createMany.mock.calls[0][0].skipDuplicates).toBe(true)
        // Records go in chunks under the bind-parameter limit.
        const recordCalls = model('attendanceRecord').createMany.mock.calls
        expect(recordCalls.length).toBeGreaterThan(1)
        expect(recordCalls.every((c) => c[0].data.length <= 1000)).toBe(true)
    })

    it('refreshes the kept demo accounts', async () => {
        const { tx, model } = buildTx()
        await run(tx)
        const updated = model('user').update.mock.calls.map((c) => c[0].where.id)
        expect(updated.sort()).toEqual(Object.values(plan.accountUserIds).sort())
    })

    it('freezes through the freeze service and recomputes the last visit', async () => {
        const { tx, $executeRaw } = buildTx()
        const freezes = await run(tx)
        expect(freezes.createInTx).toHaveBeenCalledTimes(plan.liveFreezes.length)
        expect(freezes.createInTx.mock.calls[0][1]).toMatchObject({
            workspaceId: plan.workspaceId,
            subscriptionId: plan.liveFreezes[0].subscriptionId,
            now: NOW,
        })
        expect($executeRaw).toHaveBeenCalledTimes(1)
    })

    it('uses the fixed join code, or a fresh one when another club holds it', async () => {
        const free = buildTx()
        await run(free.tx)
        expect(free.model('workspaceJoinCode').create.mock.calls[0][0].data.code).toBe('ARSENA77')
        const taken = buildTx({ codeTaken: true })
        await run(taken.tx)
        const code = taken.model('workspaceJoinCode').create.mock.calls[0][0].data.code
        expect(code).not.toBe('ARSENA77')
        expect(code).toMatch(/^[2-9A-HJ-KMNP-Z]{8}$/)
    })

    it('refuses without the roles seeded', async () => {
        const { tx, calls } = buildTx({ roles: ['admin'] })
        await expect(run(tx)).rejects.toBeInstanceOf(BadRequestError)
        expect(calls).toEqual([])
    })

    it('refuses when a demo address belongs to a real account', async () => {
        const { tx, calls } = buildTx({ taken: ['owner@arsenal.demo'] })
        await expect(run(tx)).rejects.toThrow(/owner@arsenal\.demo/)
        expect(calls).toEqual([])
    })
})
