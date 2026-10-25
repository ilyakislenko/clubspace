import { ForbiddenError } from '../../shared/errors/shared.errors'
import { DeclineSubscriptionFreezeRequestFeature } from './decline-subscription-freeze-request.feature'
import { DeclineSubscriptionFreezeRequestHandler } from './decline-subscription-freeze-request.handler'

const requestRow = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    workspaceId: 'w1',
    subscriptionId: 's1',
    userId: 'm1',
    status: 'PENDING',
    fromDate: new Date('2026-10-28T00:00:00Z'),
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

const build = (
    o: {
        row?: unknown
        admin?: boolean
        canWriteMember?: boolean
        claim?: number
        decidedBy?: unknown
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
    const prisma = {
        subscriptionFreezeRequest: {
            findFirst: jest
                .fn()
                .mockResolvedValue(o.row === undefined ? requestRow() : o.row),
            updateMany: jest.fn().mockResolvedValue({ count: o.claim ?? 1 }),
            findUniqueOrThrow: jest.fn().mockResolvedValue(
                requestRow({
                    status: 'DECLINED',
                    decidedAt: new Date(),
                    decidedBy:
                        o.decidedBy === undefined
                            ? { firstname: 'Илья', lastname: 'Кислов' }
                            : o.decidedBy,
                }),
            ),
        },
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const notifications = { notifyUser: jest.fn().mockResolvedValue(true) }
    const realtime = { invalidate: jest.fn() }
    const handler = new DeclineSubscriptionFreezeRequestHandler(
        prisma as never,
        rbac as never,
        audit as never,
        notifications as never,
        realtime as never,
    )
    return { handler, prisma, rbac, audit, notifications, realtime }
}

const feature = (
    payload: Record<string, unknown> = {},
    roleName: string | null = 'admin',
    invoker = 'inv',
) =>
    new DeclineSubscriptionFreezeRequestFeature(
        payload,
        'w1',
        'r1',
        invoker,
        roleName,
        false,
    )

describe('DeclineSubscriptionFreezeRequestHandler', () => {
    describe('authorization', () => {
        it('propagates the scope refusal for a plain member', async () => {
            const { handler, rbac, prisma } = build()
            rbac.resolveCoachScope.mockRejectedValue(
                new ForbiddenError({ message: 'Нужны права администратора клуба' }),
            )
            await expect(handler.execute(feature({}, 'user'))).rejects.toThrow(
                /Нужны права/,
            )
            expect(prisma.subscriptionFreezeRequest.updateMany).not.toHaveBeenCalled()
        })

        it('forbids a coach outside the member\'s groups', async () => {
            const { handler } = build({ admin: false, canWriteMember: false })
            await expect(handler.execute(feature({}, 'coach'))).rejects.toThrow(
                /не состоит в ваших группах/,
            )
        })

        it('forbids a coach declining their own request', async () => {
            const { handler } = build({
                admin: false,
                row: requestRow({ userId: 'inv' }),
            })
            await expect(handler.execute(feature({}, 'coach'))).rejects.toThrow(
                /собственную заявку/,
            )
        })

        it('lets an admin and the owner through', async () => {
            await expect(
                build({ row: requestRow({ userId: 'inv' }) }).handler.execute(
                    feature(),
                ),
            ).resolves.toBeDefined()
            await expect(
                build().handler.execute(feature({}, null, 'owner')),
            ).resolves.toBeDefined()
        })

        it('answers 404 for an unknown request and 409 for a decided one', async () => {
            await expect(
                build({ row: null }).handler.execute(feature()),
            ).rejects.toThrow(/не найдена/)
            await expect(
                build({ row: requestRow({ status: 'APPROVED' }) }).handler.execute(
                    feature(),
                ),
            ).rejects.toThrow(/уже одобрена/)
        })
    })

    it('answers 409 when the claim loses the race, without audit or notice', async () => {
        const { handler, audit, notifications } = build({ claim: 0 })
        await expect(handler.execute(feature())).rejects.toThrow(
            /только что рассмотрели/,
        )
        expect(audit.record).not.toHaveBeenCalled()
        expect(notifications.notifyUser).not.toHaveBeenCalled()
    })

    it('trims to a comment, frees the pending slot, audits and notifies with it', async () => {
        const { handler, prisma, audit, realtime, notifications } = build()
        const out = await handler.execute(feature({ comment: 'Приходите в субботу' }))

        expect(prisma.subscriptionFreezeRequest.updateMany).toHaveBeenCalledWith({
            where: { id: 'r1', status: 'PENDING' },
            data: {
                status: 'DECLINED',
                pendingSubscriptionId: null,
                decidedById: 'inv',
                decidedAt: expect.any(Date),
                decisionComment: 'Приходите в субботу',
            },
        })
        expect(audit.record).toHaveBeenCalledWith({
            action: 'member.declineFreezeRequest',
            targetType: 'member',
            targetId: 'm1',
            workspaceId: 'w1',
            actorId: 'inv',
            metadata: {
                planName: 'Месяц',
                fromDate: '2026-10-28',
                days: 7,
                reason: 'Травма',
                comment: 'Приходите в субботу',
            },
        })
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', [
            'subscription',
            'freeze-requests',
        ])
        expect(notifications.notifyUser.mock.calls[0][0]).toMatchObject({
            userId: 'm1',
            kind: 'freeze.declined',
            refId: 'r1:declined:m1',
            topic: 'Заявка на заморозку отклонена',
            message: 'Кислов Илья: «Приходите в субботу»',
        })
        expect(out).toMatchObject({ status: 'DECLINED', decidedByName: 'Кислов Илья' })
    })

    it('stores an empty comment as null and sends the default message', async () => {
        const { handler, prisma, notifications } = build()
        await handler.execute(feature({ comment: '' }))
        expect(
            prisma.subscriptionFreezeRequest.updateMany.mock.calls[0][0].data
                .decisionComment,
        ).toBeNull()
        expect(notifications.notifyUser.mock.calls[0][0].message).toBe(
            'Если есть вопросы — свяжитесь с тренером группы',
        )
    })

    it('falls back to «Тренер» for a nameless decider', async () => {
        const { handler, notifications } = build({
            decidedBy: { firstname: null, lastname: null },
        })
        await handler.execute(feature({ comment: 'Нет' }))
        expect(notifications.notifyUser.mock.calls[0][0].message).toBe(
            'Тренер: «Нет»',
        )
    })
})
