import {
    BadRequestError,
    ForbiddenError,
} from '../../shared/errors/shared.errors'
import { SelfCheckInPreviewFeature } from './self-check-in-preview.feature'
import { SelfCheckInPreviewHandler } from './self-check-in-preview.handler'

const LIVE = new Date(Date.now() + 30 * 24 * 3600 * 1000)

const sub = (
    id: string,
    over: {
        classesTotal?: number | null
        classesRemaining?: number | null
        directions?: string[]
        frozen?: boolean
    } = {},
) => ({
    id,
    status: 'ACTIVE',
    startDate: null,
    endDate: LIVE,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    classesTotal: over.classesTotal === undefined ? 10 : over.classesTotal,
    classesRemaining:
        over.classesRemaining === undefined ? 3 : over.classesRemaining,
    startsOnFirstVisit: false,
    plan: { name: `Plan ${id}` },
    workspaceMember: { userId: 'u1' },
    directions: (over.directions ?? []).map((d) => ({
        directionId: d,
        direction: { id: d, name: d, color: null, icon: null },
    })),
    freezes: over.frozen ? [{ id: 'fr' }] : [],
})

const makePrisma = (opts: {
    session?: unknown
    status?: string
    subs?: unknown[]
    direction?: string | null
    record?: { usedSubscriptionId: string | null } | null
    usedRow?: unknown
    frozenUntil?: Date
} = {}) => {
    const write = () => jest.fn(() => {
        throw new Error('the preview must not write')
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = {
        attendanceSession: {
            findFirst: jest.fn().mockResolvedValue(
                'session' in opts
                    ? opts.session
                    : {
                          id: 's1',
                          title: 'Вечерняя',
                          startAt: new Date('2026-07-20T18:00:00Z'),
                          groupId: 'g1',
                      },
            ),
            findUnique: jest.fn().mockResolvedValue({
                group: { directionId: opts.direction ?? null },
                workspaceEvent: null,
            }),
        },
        workspaceMember: {
            findFirst: jest.fn().mockResolvedValue({
                status: opts.status ?? 'ACTIVE',
                workspace: { timezone: 'Europe/Moscow' },
            }),
        },
        subscription: {
            findMany: jest.fn(async ({ where }: { where: { id?: unknown } }) =>
                where.id
                    ? opts.usedRow
                        ? [opts.usedRow]
                        : []
                    : (opts.subs ?? [sub('sub1')]),
            ),
            updateMany: write(),
            updateManyAndReturn: write(),
            update: write(),
        },
        subscriptionFreeze: {
            findFirst: jest
                .fn()
                .mockResolvedValue(
                    opts.frozenUntil ? { untilDate: opts.frozenUntil } : null,
                ),
        },
        attendanceRecord: {
            findUnique: jest.fn().mockResolvedValue(opts.record ?? null),
            createMany: write(),
            updateMany: write(),
        },
        $executeRaw: write(),
        $transaction: write(),
    }
    return p
}

const run = (prisma: unknown, code = 'abc234') =>
    new SelfCheckInPreviewHandler(prisma as never).execute(
        new SelfCheckInPreviewFeature({ code }, 'w1', 'u1'),
    )

describe('previewSelfCheckIn', () => {
    it('shows the default abonement and the choices, in precedence order, without writing', async () => {
        const prisma = makePrisma({
            subs: [
                sub('club', { classesTotal: null, classesRemaining: null }),
                sub('bjj', { directions: ['bjj'] }),
                sub('mma', { directions: ['mma'] }),
            ],
            direction: 'bjj',
        })
        const res = await run(prisma)
        expect(res).toMatchObject({
            sessionId: 's1',
            sessionTitle: 'Вечерняя',
            startAt: '2026-07-20T18:00:00.000Z',
            alreadyCheckedIn: false,
            abonement: { subscriptionId: 'bjj', classesRemaining: 3 },
        })
        expect(res.abonementOptions.map((a) => a.subscriptionId)).toEqual([
            'bjj',
            'club',
        ])
        expect(prisma.attendanceSession.findFirst.mock.calls[0][0].where.checkInCode).toBe(
            'ABC234',
        )
        expect(prisma.attendanceRecord.findUnique).toHaveBeenCalledWith({
            where: { sessionId_userId: { sessionId: 's1', userId: 'u1' } },
            select: { usedSubscriptionId: true },
        })
    })

    it('shows what an earlier check-in was spent on', async () => {
        const prisma = makePrisma({
            subs: [
                sub('bjj', { directions: ['bjj'], classesRemaining: 0 }),
                sub('club', { classesTotal: null, classesRemaining: null }),
            ],
            direction: 'bjj',
            record: { usedSubscriptionId: 'bjj' },
            usedRow: {
                id: 'bjj',
                classesTotal: 10,
                classesRemaining: 0,
                endDate: LIVE,
                plan: { name: 'Plan bjj' },
                directions: [{ direction: { id: 'bjj', name: 'bjj', color: null, icon: null } }],
            },
        })
        const res = await run(prisma)
        expect(res.alreadyCheckedIn).toBe(true)
        expect(res.abonement).toMatchObject({ subscriptionId: 'bjj', classesRemaining: 0 })
        expect(res.abonementOptions.map((a) => a.subscriptionId)).toEqual(['bjj', 'club'])
    })

    it('an unattributed earlier check-in shows no abonement', async () => {
        const res = await run(makePrisma({ subs: [], record: { usedSubscriptionId: null } }))
        expect(res).toMatchObject({
            alreadyCheckedIn: true,
            abonement: null,
            abonementOptions: [],
        })
    })

    it('refuses an unknown / expired code like the check-in', async () => {
        await expect(run(makePrisma({ session: null }))).rejects.toBeInstanceOf(
            BadRequestError,
        )
    })

    it('refuses a non-active member like the check-in', async () => {
        await expect(run(makePrisma({ status: 'SUSPENDED' }))).rejects.toBeInstanceOf(
            ForbiddenError,
        )
    })

    it('refuses when the only covering abonement is frozen that day', async () => {
        const prisma = makePrisma({
            subs: [sub('sub1', { frozen: true })],
            frozenUntil: new Date('2026-10-30T00:00:00Z'),
        })
        await expect(run(prisma)).rejects.toThrow(/Абонемент заморожен по 30 октября/)
    })
})
