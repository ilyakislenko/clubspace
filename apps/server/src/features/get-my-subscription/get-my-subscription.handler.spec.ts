import { GetMySubscriptionFeature } from './get-my-subscription.feature'
import { GetMySubscriptionHandler } from './get-my-subscription.handler'

// Dates are relative to "now" on purpose: a fixed endDate silently becomes
// "expired" once the calendar passes it.
const IN_30_DAYS = new Date(Date.now() + 30 * 24 * 3600 * 1000)
const A_DAY_AGO = new Date(Date.now() - 24 * 3600 * 1000)

type Row = Record<string, unknown>

const subRow = (over: Row = {}): Row => ({
    id: 's1',
    planId: 'p1',
    plan: { name: 'Безлимит месяц' },
    directions: [],
    status: 'ACTIVE',
    startDate: new Date('2026-07-01T00:00:00Z'),
    endDate: IN_30_DAYS,
    amountPaid: 5000,
    currency: 'RUB',
    source: 'MANUAL',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    ...over,
})

const requestRow = (over: Row = {}) => ({
    id: 'r1',
    subscriptionId: 's1',
    userId: 'me',
    status: 'PENDING',
    fromDate: new Date('2999-10-24T00:00:00Z'),
    days: 7,
    reason: 'Травма',
    decisionComment: null,
    decidedAt: null,
    decidedBy: null,
    createdAt: new Date('2026-10-24T09:00:00Z'),
    ...over,
})

const freezeRow = {
    id: 'f1',
    subscriptionId: 's1',
    fromDate: new Date('2999-10-24T00:00:00Z'),
    untilDate: new Date('2999-10-30T00:00:00Z'),
    reason: 'Травма',
    endedEarlyAt: null,
    createdAt: new Date('2026-10-24T09:00:00Z'),
}

// `subs` is the member's whole history; the current query gets the rows the
// DB filter (ACTIVE, not past endDate) would return, with their latest
// request and open freeze attached.
const build = (
    subs: Row[] = [subRow()],
    o: {
        requests?: Record<string, unknown>
        freezes?: Record<string, unknown>
        coach?: Record<string, unknown> | null
        member?: Row | null
    } = {},
) => {
    const now = Date.now()
    const current = subs
        .filter(
            (s) =>
                s.status === 'ACTIVE' &&
                (s.endDate === null || (s.endDate as Date).getTime() > now),
        )
        .map((s) => ({
            ...s,
            freezeRequests: o.requests?.[s.id as string]
                ? [o.requests[s.id as string]]
                : [],
            freezes: o.freezes?.[s.id as string] ? [o.freezes[s.id as string]] : [],
        }))
    return {
        workspaceMember: {
            findFirst: jest.fn().mockResolvedValue(
                o.member === undefined
                    ? {
                          id: 'wm1',
                          workspace: { timezone: 'Europe/Moscow' },
                          accessUntil: IN_30_DAYS,
                      }
                    : o.member,
            ),
        },
        groupMember: {
            findFirst: jest.fn().mockResolvedValue(
                o.coach
                    ? { group: { workspace: { ownerId: 'owner' }, coach: o.coach } }
                    : null,
            ),
        },
        subscription: {
            findMany: jest.fn(async (args: { where: Row }) =>
                'OR' in args.where ? current : subs,
            ),
        },
    }
}

const run = (prisma: unknown) =>
    new GetMySubscriptionHandler(prisma as never).execute(
        new GetMySubscriptionFeature('w1', 'me'),
    )

describe('getMySubscription', () => {
    it('returns the current abonements, history and accessUntil', async () => {
        const out = await run(
            build([subRow(), subRow({ id: 's0', status: 'EXPIRED' })]),
        )
        expect(out.abonements.map((a) => a.id)).toEqual(['s1'])
        expect(out.abonements[0].planName).toBe('Безлимит месяц')
        expect(out.history).toHaveLength(2)
        expect(out.accessUntil).toBe(IN_30_DAYS.toISOString())
    })

    it('returns empty for someone with no member row (owner)', async () => {
        const out = await run(build([], { member: null }))
        expect(out).toEqual({
            abonements: [],
            history: [],
            accessUntil: null,
            coach: null,
        })
    })

    it('does not report an expired or cancelled abonement as current, but keeps it in history', async () => {
        const out = await run(
            build([
                subRow({ endDate: A_DAY_AGO }),
                subRow({ id: 's2', status: 'CANCELLED' }),
            ]),
        )
        expect(out.abonements).toEqual([])
        expect(out.history).toHaveLength(2)
    })

    it('lists two parallel abonements, each with its own freeze state', async () => {
        const bjj = subRow({
            id: 's1',
            directions: [
                { direction: { id: 'd1', name: 'БЖЖ', color: null, icon: null } },
            ],
        })
        const muay = subRow({ id: 's2' })
        const prisma = build([bjj, muay], {
            freezes: { s1: freezeRow },
            requests: { s2: requestRow({ id: 'r2', subscriptionId: 's2' }) },
        })
        const out = await run(prisma)
        expect(out.abonements).toHaveLength(2)
        const [a, b] = out.abonements
        expect(a).toMatchObject({
            id: 's1',
            directions: [{ id: 'd1', name: 'БЖЖ' }],
            freeze: { id: 'f1', fromDate: '2999-10-24', untilDate: '2999-10-30', days: 7 },
            freezeRequest: null,
            freezeRequestWindow: null,
        })
        expect(b).toMatchObject({
            id: 's2',
            freeze: null,
            freezeRequest: { id: 'r2', status: 'PENDING' },
            freezeRequestWindow: null,
        })
        // One query for the current ones, freezes and requests nested in it.
        const currentQuery = prisma.subscription.findMany.mock.calls.find(
            ([args]) => 'OR' in args.where,
        )?.[0] as unknown as { include: Row; where: Row }
        // The member scope survives the "held" filter (NOT key, not an overwrite).
        expect(currentQuery.where).toMatchObject({
            workspaceMemberId: 'wm1',
            NOT: { workspaceMemberId: null },
        })
        expect(currentQuery.include).toHaveProperty('freezes')
        expect(currentQuery.include).toHaveProperty('freezeRequests')
    })

    describe('freeze request', () => {
        const withRequest = (request: Row | null) =>
            build([subRow()], { requests: request ? { s1: request } : {} })

        it('offers a window and no request on a freezable abonement', async () => {
            const [a] = (await run(withRequest(null))).abonements
            expect(a.freezeRequest).toBeNull()
            expect(a.freezeRequestWindow).toMatchObject({ maxDays: 90 })
        })

        it('shows the pending request and closes the window', async () => {
            const [a] = (await run(withRequest(requestRow()))).abonements
            expect(a.freezeRequest).toMatchObject({
                id: 'r1',
                status: 'PENDING',
                fromDate: '2999-10-24',
                untilDate: '2999-10-30',
            })
            expect(a.freezeRequestWindow).toBeNull()
        })

        it('shows a recent decline with the coach name and still offers a window', async () => {
            const [a] = (
                await run(
                    withRequest(
                        requestRow({
                            status: 'DECLINED',
                            decisionComment: 'Приходите в субботу',
                            decidedAt: new Date(),
                            decidedBy: { firstname: 'Илья', lastname: 'Кислов' },
                        }),
                    ),
                )
            ).abonements
            expect(a.freezeRequest).toMatchObject({
                status: 'DECLINED',
                decidedByName: 'Кислов Илья',
            })
            expect(a.freezeRequestWindow).not.toBeNull()
        })

        it('hides an old decline behind a newer approved request', async () => {
            const [a] = (
                await run(
                    withRequest(requestRow({ status: 'APPROVED', decidedAt: new Date() })),
                )
            ).abonements
            expect(a.freezeRequest).toBeNull()
        })

        it('hides a decline older than a week', async () => {
            const [a] = (
                await run(
                    withRequest(
                        requestRow({
                            status: 'DECLINED',
                            decidedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000),
                        }),
                    ),
                )
            ).abonements
            expect(a.freezeRequest).toBeNull()
        })
    })

    describe('coach', () => {
        it('returns the name and phone of the group coach (the owner needs no member row)', async () => {
            const out = await run(
                build([subRow()], {
                    coach: {
                        id: 'owner',
                        firstname: 'Илья',
                        lastname: 'Кислов',
                        phone: '+79528849420',
                        status: 'ACTIVE',
                    },
                }),
            )
            expect(out.coach).toEqual({ name: 'Кислов Илья', phone: '+79528849420' })
        })

        it('is null when the member has no group', async () => {
            expect((await run(build([subRow()]))).coach).toBeNull()
        })

        it('is null for a coach without a name (never falls back to e-mail)', async () => {
            const out = await run(
                build([subRow()], {
                    coach: {
                        id: 'owner',
                        firstname: null,
                        lastname: null,
                        phone: '+79528849420',
                        status: 'ACTIVE',
                    },
                }),
            )
            expect(out.coach).toBeNull()
        })
    })
})
