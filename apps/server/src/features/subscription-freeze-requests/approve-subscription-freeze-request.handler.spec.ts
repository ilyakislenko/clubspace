import { ForbiddenError } from '../../shared/errors/shared.errors'
import { ApproveSubscriptionFreezeRequestFeature } from './approve-subscription-freeze-request.feature'
import { ApproveSubscriptionFreezeRequestHandler } from './approve-subscription-freeze-request.handler'

const today = new Date().toISOString().slice(0, 10)
const plusDays = (n: number) =>
    new Date(Date.now() + n * 24 * 3600 * 1000).toISOString().slice(0, 10)

const requestRow = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    workspaceId: 'w1',
    subscriptionId: 's1',
    userId: 'm1',
    status: 'PENDING',
    fromDate: new Date(`${plusDays(3)}T00:00:00Z`),
    days: 7,
    reason: 'Травма',
    decisionComment: null,
    decidedAt: null,
    createdAt: new Date('2026-10-24T09:00:00Z'),
    user: { firstname: 'Анна', lastname: 'Ким', email: 'a@x' },
    subscription: { plan: { name: 'Месяц' } },
    workspace: { timezone: 'UTC' },
    ...over,
})

const freezeRow = () => ({
    id: 'f1',
    subscriptionId: 's1',
    fromDate: new Date('2026-10-28T00:00:00Z'),
    untilDate: new Date('2026-11-03T00:00:00Z'),
    reason: 'Травма',
    endedEarlyAt: null,
    createdAt: new Date('2026-10-25T09:00:00Z'),
})

const build = (
    o: {
        row?: unknown
        admin?: boolean
        canWriteMember?: boolean
        claim?: number
        createError?: Error
    } = {},
) => {
    const admin = o.admin ?? true
    const rbac = {
        resolveCoachScope: jest
            .fn()
            .mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
        canWriteAllGroups: jest.fn().mockReturnValue(admin),
        assertCanWriteMember: jest.fn().mockImplementation(async () => {
            if (o.canWriteMember === false) {
                throw new ForbiddenError({
                    message: 'Участник не состоит в ваших группах',
                })
            }
        }),
    }
    const tx = {
        subscriptionFreezeRequest: {
            updateMany: jest.fn().mockResolvedValue({ count: o.claim ?? 1 }),
            findUniqueOrThrow: jest.fn().mockResolvedValue(
                requestRow({
                    status: 'APPROVED',
                    decidedAt: new Date(),
                    decidedBy: { firstname: 'Илья', lastname: 'Кислов' },
                }),
            ),
        },
    }
    const prisma = {
        subscriptionFreezeRequest: {
            findFirst: jest
                .fn()
                .mockResolvedValue(o.row === undefined ? requestRow() : o.row),
        },
        $transaction: jest.fn().mockImplementation((fn) => fn(tx)),
    }
    const freezes = {
        createInTx: o.createError
            ? jest.fn().mockRejectedValue(o.createError)
            : jest.fn().mockResolvedValue({
                  freeze: freezeRow(),
                  subscription: {},
                  accessUntil: null,
              }),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const notifications = { notifyUser: jest.fn().mockResolvedValue(true) }
    const realtime = { invalidate: jest.fn() }
    const handler = new ApproveSubscriptionFreezeRequestHandler(
        prisma as never,
        rbac as never,
        freezes as never,
        audit as never,
        notifications as never,
        realtime as never,
    )
    return { handler, prisma, tx, rbac, freezes, audit, notifications, realtime }
}

const feature = (
    payload: Record<string, unknown> = {},
    roleName: string | null = 'admin',
    invoker = 'inv',
) =>
    new ApproveSubscriptionFreezeRequestFeature(
        payload,
        'w1',
        'r1',
        invoker,
        roleName,
        false,
    )

describe('ApproveSubscriptionFreezeRequestHandler', () => {
    describe('authorization', () => {
        it('propagates the scope refusal for a plain member', async () => {
            const { handler, rbac, freezes } = build()
            rbac.resolveCoachScope.mockRejectedValue(
                new ForbiddenError({ message: 'Нужны права администратора клуба' }),
            )
            await expect(handler.execute(feature({}, 'user'))).rejects.toThrow(
                /Нужны права/,
            )
            expect(freezes.createInTx).not.toHaveBeenCalled()
        })

        it('forbids a coach outside the member\'s groups', async () => {
            const { handler, freezes } = build({
                admin: false,
                canWriteMember: false,
            })
            await expect(handler.execute(feature({}, 'coach'))).rejects.toThrow(
                /не состоит в ваших группах/,
            )
            expect(freezes.createInTx).not.toHaveBeenCalled()
        })

        it('forbids a coach deciding their own request', async () => {
            const { handler } = build({
                admin: false,
                row: requestRow({ userId: 'inv' }),
            })
            await expect(handler.execute(feature({}, 'coach'))).rejects.toThrow(
                /собственную заявку/,
            )
        })

        it('lets an admin approve their own request', async () => {
            const { handler } = build({ row: requestRow({ userId: 'inv' }) })
            await expect(handler.execute(feature())).resolves.toBeDefined()
        })

        it('lets the owner (no member row) through admin scope', async () => {
            const { handler, rbac } = build()
            await handler.execute(feature({}, null, 'owner'))
            expect(rbac.resolveCoachScope).toHaveBeenCalledWith(
                expect.objectContaining({ userId: 'owner', roleName: null }),
            )
        })

        it('answers 404 for an unknown request', async () => {
            const { handler } = build({ row: null })
            await expect(handler.execute(feature())).rejects.toThrow(/не найдена/)
        })

        it.each([
            ['DECLINED', /уже отклонена/],
            ['APPROVED', /уже одобрена/],
            ['CANCELLED', /отменил/],
        ])('answers 409 for a %s request', async (status, message) => {
            const { handler, freezes } = build({ row: requestRow({ status }) })
            await expect(handler.execute(feature())).rejects.toThrow(message)
            expect(freezes.createInTx).not.toHaveBeenCalled()
        })
    })

    it('answers 409 and creates no freeze when the claim loses the race', async () => {
        const { handler, freezes, audit, notifications } = build({ claim: 0 })
        await expect(handler.execute(feature())).rejects.toThrow(
            /только что рассмотрели/,
        )
        expect(freezes.createInTx).not.toHaveBeenCalled()
        expect(audit.record).not.toHaveBeenCalled()
        expect(notifications.notifyUser).not.toHaveBeenCalled()
    })

    describe('freeze values', () => {
        it('uses a future requested start and the requested length', async () => {
            const { handler, freezes, tx } = build()
            await handler.execute(feature())
            expect(freezes.createInTx).toHaveBeenCalledWith(
                tx,
                expect.objectContaining({
                    workspaceId: 'w1',
                    userId: 'm1',
                    subscriptionId: 's1',
                    days: 7,
                    fromDate: plusDays(3),
                    reason: 'Травма',
                }),
            )
        })

        it('starts today when the requested start has passed', async () => {
            const { handler, freezes } = build({
                row: requestRow({
                    fromDate: new Date(`${plusDays(-4)}T00:00:00Z`),
                }),
            })
            await handler.execute(feature())
            expect(freezes.createInTx.mock.calls[0][1].fromDate).toBe(today)
        })

        it('passes the coach overrides through', async () => {
            const { handler, freezes } = build()
            await handler.execute(
                feature({ fromDate: plusDays(10), days: 14, reason: 'Отпуск' }),
            )
            expect(freezes.createInTx.mock.calls[0][1]).toMatchObject({
                fromDate: plusDays(10),
                days: 14,
                reason: 'Отпуск',
            })
        })
    })

    it('claims PENDING inside the transaction, freeing the pending slot', async () => {
        const { handler, tx, prisma } = build()
        await handler.execute(feature())
        expect(prisma.$transaction).toHaveBeenCalledTimes(1)
        expect(tx.subscriptionFreezeRequest.updateMany).toHaveBeenCalledWith({
            where: { id: 'r1', status: 'PENDING' },
            data: {
                status: 'APPROVED',
                pendingSubscriptionId: null,
                decidedById: 'inv',
                decidedAt: expect.any(Date),
            },
        })
    })

    it('propagates a service refusal and neither audits nor notifies', async () => {
        const { handler, audit, notifications, realtime } = build({
            createError: new Error('Заморозка — от 1 до 90 дней'),
        })
        await expect(handler.execute(feature())).rejects.toThrow(/от 1 до 90/)
        expect(audit.record).not.toHaveBeenCalled()
        expect(notifications.notifyUser).not.toHaveBeenCalled()
        expect(realtime.invalidate).not.toHaveBeenCalled()
    })

    it('audits, refreshes, notifies the member and returns both', async () => {
        const { handler, audit, realtime, notifications } = build()
        const out = await handler.execute(feature())

        expect(audit.record).toHaveBeenCalledWith({
            action: 'member.approveFreezeRequest',
            targetType: 'member',
            targetId: 'm1',
            workspaceId: 'w1',
            actorId: 'inv',
            metadata: {
                planName: 'Месяц',
                fromDate: '2026-10-28',
                untilDate: '2026-11-03',
                days: 7,
                reason: 'Травма',
                requestedFromDate: plusDays(3),
                requestedDays: 7,
            },
        })
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', [
            'members',
            'subscription',
            'attendance',
            'freeze-requests',
        ])
        expect(notifications.notifyUser).toHaveBeenCalledTimes(1)
        expect(notifications.notifyUser.mock.calls[0][0]).toMatchObject({
            userId: 'm1',
            kind: 'freeze.approved',
            refId: 'r1:approved:m1',
            feature: 'subscription',
        })
        expect(out.request).toMatchObject({
            status: 'APPROVED',
            decidedByName: 'Кислов Илья',
        })
        expect(out.freeze).toMatchObject({ id: 'f1', days: 7 })
    })
})
