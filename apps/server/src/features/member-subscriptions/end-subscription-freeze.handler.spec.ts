import { NotFoundError } from '../../shared/errors/shared.errors'
import { EndSubscriptionFreezeFeature } from './end-subscription-freeze.feature'
import { EndSubscriptionFreezeHandler } from './end-subscription-freeze.handler'

const subRow = () => ({
    id: 's1',
    planId: 'p1',
    plan: { name: 'Monthly' },
    status: 'ACTIVE',
    startDate: new Date('2026-10-01T00:00:00Z'),
    endDate: new Date('2026-11-01T00:00:00Z'),
    amountPaid: 5000,
    currency: 'RUB',
    classesTotal: null,
    classesRemaining: null,
    source: 'MANUAL',
    createdAt: new Date('2026-10-01T00:00:00Z'),
})

const original = {
    fromDate: new Date('2026-10-24T00:00:00Z'),
    untilDate: new Date('2026-10-30T00:00:00Z'),
}

const rbac = (admin = true) => ({
    resolveCoachScope: jest
        .fn()
        .mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
    canWriteAllGroups: jest.fn().mockReturnValue(admin),
})

const build = (admin = true) => {
    const freezes = {
        end: jest.fn().mockResolvedValue({
            freeze: {
                id: 'f1',
                subscriptionId: 's1',
                fromDate: original.fromDate,
                untilDate: new Date('2026-10-26T00:00:00Z'),
                reason: null,
                endedEarlyAt: new Date('2026-10-27T10:00:00Z'),
                createdAt: new Date('2026-10-24T09:00:00Z'),
            },
            removed: false,
            returnedDays: 4,
            original,
            subscription: subRow(),
            accessUntil: null,
        }),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const realtime = { invalidate: jest.fn() }
    const handler = new EndSubscriptionFreezeHandler(
        rbac(admin) as never,
        freezes as never,
        audit as never,
        realtime as never,
    )
    return { handler, freezes, audit, realtime }
}

const feature = (roleName: string | null = 'admin') =>
    new EndSubscriptionFreezeFeature(
        'w1',
        'u1',
        's1',
        'f1',
        'inv',
        roleName,
        false,
    )

describe('EndSubscriptionFreezeHandler', () => {
    it('forbids a non-admin without touching the service', async () => {
        const { handler, freezes } = build(false)
        await expect(handler.execute(feature('coach'))).rejects.toThrow(
            /администратор/i,
        )
        expect(freezes.end).not.toHaveBeenCalled()
    })

    it('lets the owner through (rbac resolves the admin scope)', async () => {
        const { handler, freezes } = build()
        await handler.execute(feature(null))
        expect(freezes.end).toHaveBeenCalledWith({
            workspaceId: 'w1',
            userId: 'u1',
            subscriptionId: 's1',
            freezeId: 'f1',
        })
    })

    it('shrunk freeze: serializes it and audits member.endFreeze with the original dates', async () => {
        const { handler, audit, realtime } = build()
        const out = await handler.execute(feature())
        expect(out.freeze).toMatchObject({
            id: 'f1',
            untilDate: '2026-10-26',
            days: 3,
            endedEarlyAt: '2026-10-27T10:00:00.000Z',
        })
        expect(out.returnedDays).toBe(4)
        expect(out.accessUntil).toBeNull()
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'member.endFreeze',
                targetId: 'u1',
                actorId: 'inv',
                metadata: {
                    planName: 'Monthly',
                    fromDate: '2026-10-24',
                    untilDate: '2026-10-30',
                    returnedDays: 4,
                },
            }),
        )
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', ['subscription'])
    })

    it('removed freeze: returns freeze null and audits member.cancelFreeze', async () => {
        const { handler, freezes, audit } = build()
        freezes.end.mockResolvedValue({
            freeze: null,
            removed: true,
            returnedDays: 7,
            original,
            subscription: subRow(),
            accessUntil: new Date('2026-11-01T00:00:00Z'),
        })
        const out = await handler.execute(feature())
        expect(out.freeze).toBeNull()
        expect(out.returnedDays).toBe(7)
        expect(out.accessUntil).toBe('2026-11-01T00:00:00.000Z')
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'member.cancelFreeze' }),
        )
    })

    it('propagates a not-found and records nothing', async () => {
        const { handler, freezes, audit } = build()
        freezes.end.mockRejectedValue(
            new NotFoundError({ message: 'Заморозка не найдена' }),
        )
        await expect(handler.execute(feature())).rejects.toThrow(
            /Заморозка не найдена/,
        )
        expect(audit.record).not.toHaveBeenCalled()
    })
})
