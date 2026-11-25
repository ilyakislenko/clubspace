jest.mock('../../infrastructure/prisma', () => ({ PrismaService: class {} }))
jest.mock('../../domains/payroll/payroll-loader', () => ({
    ...jest.requireActual('../../domains/payroll/payroll-loader'),
    computeLivePayroll: jest.fn(),
    loadPayrollClasses: jest.fn(),
    loadPayrollCurrency: jest.fn(),
}))

import {
    computeLivePayroll,
    type LivePayroll,
    loadPayrollClasses,
    loadPayrollCurrency,
} from '../../domains/payroll/payroll-loader'
import { MONTH_CLOSED_MESSAGE } from '../../domains/payroll/payroll-lock'
import type { PayrollClass, PayrollLineFact } from '../../domains/payroll/payroll-rules'
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    StaleUpdateError,
} from '../../shared/errors/shared.errors'
import {
    AddPayrollAdjustmentFeature,
    AddPayrollAdjustmentInputSchema,
} from './add-payroll-adjustment.feature'
import { AddPayrollAdjustmentHandler } from './add-payroll-adjustment.handler'
import { ClosePayrollMonthFeature } from './close-payroll-month.feature'
import {
    ALREADY_CLOSED_MESSAGE,
    ClosePayrollMonthHandler,
    TOTALS_CHANGED_MESSAGE,
} from './close-payroll-month.handler'
import { DeletePayrollAdjustmentFeature } from './delete-payroll-adjustment.feature'
import { DeletePayrollAdjustmentHandler } from './delete-payroll-adjustment.handler'
import { GetMyPayrollFeature } from './get-my-payroll.feature'
import { GetMyPayrollHandler, PAY_HIDDEN_MESSAGE } from './get-my-payroll.handler'
import { GetPayrollMonthFeature } from './get-payroll-month.feature'
import { GetPayrollMonthHandler } from './get-payroll-month.handler'
import { ListCoachRatesFeature } from './list-coach-rates.feature'
import { ListCoachRatesHandler } from './list-coach-rates.handler'
import { ListPayrollClassesFeature } from './list-payroll-classes.feature'
import { ListPayrollClassesHandler } from './list-payroll-classes.handler'
import {
    ReopenPayrollMonthFeature,
    ReopenPayrollMonthInputSchema,
} from './reopen-payroll-month.feature'
import { ReopenPayrollMonthHandler } from './reopen-payroll-month.handler'
import { SetCoachRateFeature, SetCoachRateInputSchema } from './set-coach-rate.feature'
import { NOT_STAFF_MESSAGE, SetCoachRateHandler } from './set-coach-rate.handler'

const OWNER = 'owner'
const WS = 'w1'
const COACH = 'c0a0c0a0-0000-4000-8000-000000000001'
const OTHER = 'c0a0c0a0-0000-4000-8000-000000000002'

const liveMock = computeLivePayroll as jest.MockedFunction<typeof computeLivePayroll>
const classesMock = loadPayrollClasses as jest.MockedFunction<typeof loadPayrollClasses>
const currencyMock = loadPayrollCurrency as jest.MockedFunction<typeof loadPayrollCurrency>

const rbac = () => ({
    resolveCoachScope: jest.fn(async ({ userId, roleName }: { userId: string; roleName: string | null }) => {
        if (roleName === 'user' && userId !== OWNER) {
            throw new ForbiddenError({ message: 'Нужны права администратора клуба' })
        }
        return { userId, workspaceId: WS, workspaceOwnerId: OWNER, scope: 'admin' }
    }),
    clubVocabulary: jest.fn(),
})

const line = (over: Partial<PayrollLineFact> = {}): PayrollLineFact => ({
    coachId: COACH,
    name: 'Анна Тренер',
    rate: null,
    ignoredRate: null,
    classes: 4,
    classesPaid: 3,
    marks: 20,
    marksPaid: 18,
    revenueBase: 0,
    amounts: { fixed: 1000, classes: 0, students: 0, revenue: 0, adjustments: 0 },
    total: 1000,
    ...over,
})

const live = (over: Partial<LivePayroll> = {}): LivePayroll => ({
    month: '2026-10',
    tz: 'Europe/Moscow',
    currency: 'RUB',
    lines: [line()],
    adjustments: [],
    counted: [],
    cancelled: [],
    unattributed: { classes: 0, revenue: 0, otherCurrency: 0 },
    total: 1000,
    names: new Map(),
    ...over,
})

const cls = (over: Partial<PayrollClass> = {}): PayrollClass => ({
    sessionId: 's1',
    date: '2026-10-06',
    startAt: new Date('2026-10-06T16:00:00Z'),
    groupId: 'g1',
    groupName: 'Утро',
    groupCoachIds: [COACH],
    groupPrimaryCoachId: COACH,
    coachId: COACH,
    marks: 3,
    subscriptionIds: [],
    ...over,
})

const closedRow = (over: Record<string, unknown> = {}) => ({
    id: 'pm1',
    workspaceId: WS,
    month: new Date('2026-10-01T00:00:00Z'),
    currency: 'RUB',
    total: 1000,
    unattributedClasses: 0,
    unattributedRevenue: 0,
    otherCurrencyRows: 0,
    closedAt: new Date('2026-11-02T10:00:00Z'),
    closedById: OWNER,
    closedByName: 'Ольга',
    lines: [
        {
            id: 'l1',
            payrollMonthId: 'pm1',
            workspaceId: WS,
            coachId: COACH,
            coachName: 'Анна Тренер',
            classes: 4,
            classesPaid: 3,
            marks: 20,
            marksPaid: 18,
            revenueBase: 0,
            fixedAmount: 1000,
            classAmount: 0,
            studentAmount: 0,
            revenueAmount: 0,
            adjustmentsAmount: 0,
            total: 1000,
            rate: null,
        },
    ],
    ...over,
})

const prismaMock = () => {
    const p = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({ timezone: 'Europe/Moscow', coachPayVisible: false }),
        },
        user: {
            findFirst: jest.fn().mockResolvedValue({ id: COACH }),
            findUnique: jest.fn().mockResolvedValue({ firstname: 'Ольга', lastname: 'Кузнецова', email: null }),
            findMany: jest.fn().mockResolvedValue([]),
        },
        coachRate: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: jest.fn().mockResolvedValue(null),
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
                id: 'r1',
                updatedAt: new Date('2026-11-20T10:00:00Z'),
                ...data,
            })),
            update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
                id: 'r0',
                coachId: COACH,
                effectiveFrom: new Date('2026-11-01T00:00:00Z'),
                updatedAt: new Date('2026-11-21T10:00:00Z'),
                ...data,
            })),
        },
        payrollMonth: {
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn(async ({ data }: { data: Record<string, unknown> & { lines: { createMany: { data: unknown[] } } } }) => ({
                id: 'pm-new',
                ...data,
                lines: data.lines.createMany.data,
            })),
            delete: jest.fn().mockResolvedValue({}),
        },
        payrollLine: { findMany: jest.fn().mockResolvedValue([]) },
        payrollAdjustment: {
            findFirst: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
                id: 'a1',
                createdAt: new Date('2026-11-20T10:00:00Z'),
                ...data,
            })),
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        $executeRaw: jest.fn().mockResolvedValue(1),
        $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(p)),
    }
    return p
}
type PrismaMock = ReturnType<typeof prismaMock>

const services = () => ({
    audit: { record: jest.fn().mockResolvedValue(undefined) },
    realtime: { invalidate: jest.fn() },
    notifications: { notifyUser: jest.fn().mockResolvedValue(true) },
})

beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-20T12:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] })
    liveMock.mockReset().mockResolvedValue(live())
    classesMock.mockReset().mockResolvedValue({ counted: [], cancelled: [] })
    currencyMock.mockReset().mockResolvedValue('RUB')
})
afterEach(() => jest.useRealTimers())

// Every club-admin route, invoked as `invoker` with `role`.
const ADMIN_ROUTES: Array<[string, (p: PrismaMock, role: string | null, invoker: string) => Promise<unknown>]> = [
    ['getPayrollMonth', (p, role, inv) =>
        new GetPayrollMonthHandler(p as never, rbac() as never).execute(
            new GetPayrollMonthFeature({ month: '2026-10' }, WS, inv, role, false),
        )],
    ['listPayrollClasses', (p, role, inv) =>
        new ListPayrollClassesHandler(p as never, rbac() as never).execute(
            new ListPayrollClassesFeature({ month: '2026-10' }, WS, COACH, inv, role, false),
        )],
    ['listCoachRates', (p, role, inv) =>
        new ListCoachRatesHandler(p as never, rbac() as never).execute(
            new ListCoachRatesFeature(WS, inv, role, false),
        )],
    ['setCoachRate', (p, role, inv) => {
        const s = services()
        return new SetCoachRateHandler(p as never, rbac() as never, s.audit as never, s.realtime as never).execute(
            new SetCoachRateFeature(rateBody(), WS, COACH, inv, role, false),
        )
    }],
    ['addPayrollAdjustment', (p, role, inv) => {
        const s = services()
        return new AddPayrollAdjustmentHandler(p as never, rbac() as never, s.audit as never, s.realtime as never).execute(
            new AddPayrollAdjustmentFeature(adjBody(), WS, inv, role, false),
        )
    }],
    ['deletePayrollAdjustment', (p, role, inv) => {
        const s = services()
        p.payrollAdjustment.findFirst.mockResolvedValue(adjRow())
        return new DeletePayrollAdjustmentHandler(p as never, rbac() as never, s.audit as never, s.realtime as never).execute(
            new DeletePayrollAdjustmentFeature(WS, 'a1', inv, role, false),
        )
    }],
    ['closePayrollMonth', (p, role, inv) => {
        const s = services()
        return closeHandler(p, s).execute(
            new ClosePayrollMonthFeature({ expectedTotal: 1000 }, WS, '2026-10', inv, role, false),
        )
    }],
    ['reopenPayrollMonth', (p, role, inv) => {
        const s = services()
        p.payrollMonth.findUnique.mockResolvedValueOnce(closedRow())
        return new ReopenPayrollMonthHandler(p as never, rbac() as never, s.audit as never, s.realtime as never).execute(
            new ReopenPayrollMonthFeature({ reason: 'Ошибка в посещаемости' }, WS, '2026-10', inv, role, false),
        )
    }],
]

const rateBody = (over: Record<string, unknown> = {}) =>
    SetCoachRateInputSchema.parse({
        effectiveFrom: '2026-11',
        fixedMonthly: 30000,
        perClass: 1500,
        perClassMinStudents: 3,
        perStudent: 100,
        revenueBp: 1000,
        ...over,
    })
const adjBody = (over: Record<string, unknown> = {}) =>
    AddPayrollAdjustmentInputSchema.parse({
        month: '2026-11',
        coachId: COACH,
        amount: 5000,
        comment: ' Открытый урок ',
        ...over,
    })
const adjRow = (over: Record<string, unknown> = {}) => ({
    id: 'a1',
    workspaceId: WS,
    month: new Date('2026-11-01T00:00:00Z'),
    coachId: COACH,
    amount: 5000,
    currency: 'RUB',
    comment: 'Открытый урок',
    createdById: OWNER,
    createdByName: 'Ольга',
    createdAt: new Date('2026-11-20T10:00:00Z'),
    ...over,
})
const closeHandler = (p: PrismaMock, s: ReturnType<typeof services>) =>
    new ClosePayrollMonthHandler(
        p as never,
        rbac() as never,
        s.audit as never,
        s.notifications as never,
        s.realtime as never,
    )

describe('club-admin payroll routes', () => {
    describe.each(ADMIN_ROUTES)('%s', (_name, run) => {
        it.each(['head_coach', 'coach'])('refuses a %s', async (role) => {
            const p = prismaMock()
            await expect(run(p, role, 'inv')).rejects.toBeInstanceOf(ForbiddenError)
            expect(p.$transaction).not.toHaveBeenCalled()
        })

        it('lets the owner through without a member row', async () => {
            await expect(run(prismaMock(), null, OWNER)).resolves.toBeDefined()
        })
    })
})

describe('GetPayrollMonthHandler', () => {
    const run = (p: PrismaMock) =>
        new GetPayrollMonthHandler(p as never, rbac() as never).execute(
            new GetPayrollMonthFeature({ month: '2026-10' }, WS, 'inv', 'admin', false),
        )

    it('returns a live open month that may be closed once over', async () => {
        const out = await run(prismaMock())
        expect(out).toMatchObject({ status: 'open', canClose: true, total: 1000, drift: null, closedAt: null })
        expect(out.lines[0]).toMatchObject({ coachId: COACH, total: 1000, adjustments: [] })
    })

    it('returns the frozen month with the drift of today’s data, computed with the frozen coaches as staff', async () => {
        const p = prismaMock()
        p.payrollMonth.findUnique.mockResolvedValue(closedRow())
        liveMock.mockResolvedValue(live({ total: 2200, lines: [line({ total: 2200 })] }))
        const out = await run(p)
        expect(out).toMatchObject({
            status: 'closed',
            canClose: false,
            total: 1000,
            drift: 1200,
            driftByCoach: [{ coachId: COACH, name: 'Анна Тренер', delta: 1200 }],
            closedAt: '2026-11-02T10:00:00.000Z',
            closedBy: { id: OWNER, name: 'Ольга' },
        })
        // A coach who left after the close is no drift: the frozen coaches stay staff,
        // and the month is recomputed in its frozen currency.
        expect(liveMock.mock.calls[0][1]).toEqual({
            workspaceId: WS,
            month: '2026-10',
            alsoStaff: [COACH],
            currency: 'RUB',
        })
    })

    it('reports offsetting per-coach changes: drift 0, not null', async () => {
        const p = prismaMock()
        p.payrollMonth.findUnique.mockResolvedValue(closedRow())
        liveMock.mockResolvedValue(
            live({
                total: 1000,
                lines: [line({ total: -500 }), line({ coachId: OTHER, name: 'Борис', total: 1500 })],
            }),
        )
        const out = await run(p)
        expect(out.drift).toBe(0)
        expect(out.driftByCoach).toEqual([
            { coachId: COACH, name: 'Анна Тренер', delta: -1500 },
            { coachId: OTHER, name: 'Борис', delta: 1500 },
        ])
    })

    it('a closed month with unchanged data has no drift', async () => {
        const p = prismaMock()
        p.payrollMonth.findUnique.mockResolvedValue(closedRow())
        const out = await run(p)
        expect(out.drift).toBeNull()
        expect(out.driftByCoach).toEqual([])
    })

    it('flags an adjustment in another currency than the month’s', async () => {
        liveMock.mockResolvedValue(
            live({
                adjustments: [
                    { id: 'k', coachId: COACH, amount: 9000, currency: 'KZT', comment: 'x', createdAt: new Date(), createdByName: 'О' },
                ],
            }),
        )
        const out = await run(prismaMock())
        expect(out.lines[0].adjustments).toEqual([expect.objectContaining({ id: 'k', currency: 'KZT', ignored: true })])
    })
})

describe('ListPayrollClassesHandler', () => {
    it('lists paid, unpaid, cancelled, substitute and other-coach classes', async () => {
        const p = prismaMock()
        p.coachRate.findMany.mockResolvedValue([
            { effectiveFrom: new Date('2026-01-01T00:00:00Z'), perClassMinStudents: 3, currency: 'RUB' },
        ])
        p.user.findMany.mockResolvedValue([{ id: OTHER, firstname: 'Борис', lastname: 'Замена', email: null }])
        classesMock.mockResolvedValue({
            counted: [
                cls({ sessionId: 'paid', marks: 3 }),
                cls({ sessionId: 'unpaid', marks: 2, startAt: new Date('2026-10-07T16:00:00Z') }),
                cls({ sessionId: 'sub', groupCoachIds: [OTHER], groupPrimaryCoachId: OTHER, startAt: new Date('2026-10-08T16:00:00Z') }),
                cls({ sessionId: 'other', coachId: OTHER, startAt: new Date('2026-10-09T16:00:00Z') }),
                cls({ sessionId: 'gone', coachId: null, startAt: new Date('2026-10-10T16:00:00Z') }),
            ],
            cancelled: [cls({ sessionId: 'cancel', startAt: new Date('2026-10-05T16:00:00Z') })],
        })
        const out = await new ListPayrollClassesHandler(p as never, rbac() as never).execute(
            new ListPayrollClassesFeature({ month: '2026-10' }, WS, COACH, 'inv', 'admin', false),
        )
        expect(out.items.map((i) => [i.sessionId, i.status, i.substitute, i.ranBy?.name ?? null])).toEqual([
            ['cancel', 'cancelled', false, null],
            ['paid', 'paid', false, null],
            ['unpaid', 'unpaid', false, null],
            ['sub', 'paid', true, null],
            ['other', 'other_coach', false, 'Борис Замена'],
            ['gone', 'other_coach', false, 'Не распределено'],
        ])
    })

    it('404s an unknown club', async () => {
        const p = prismaMock()
        p.workspace.findUnique.mockResolvedValue(null)
        await expect(
            new ListPayrollClassesHandler(p as never, rbac() as never).execute(
                new ListPayrollClassesFeature({ month: '2026-10' }, WS, COACH, 'inv', 'admin', false),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
    })
})

describe('ListCoachRatesHandler', () => {
    it('lists staff with their history and newest change; the owner is «owner»', async () => {
        const p = prismaMock()
        const rate = (id: string, from: string, updated: string) => ({
            id,
            coachId: COACH,
            effectiveFrom: new Date(`${from}-01T00:00:00Z`),
            fixedMonthly: 0,
            perClass: 2000,
            perClassMinStudents: 1,
            perStudent: 0,
            revenueBp: 0,
            currency: 'RUB',
            updatedAt: new Date(updated),
        })
        p.user.findMany.mockResolvedValue([
            {
                id: COACH,
                firstname: 'Яна',
                lastname: null,
                email: null,
                workspaceMemberships: [{ role: { name: 'coach' } }],
                coachRates: [rate('r2', '2026-11', '2026-11-01T00:00:00Z'), rate('r1', '2026-06', '2026-11-05T00:00:00Z')],
            },
            { id: OWNER, firstname: 'Алла', lastname: null, email: null, workspaceMemberships: [], coachRates: [] },
        ])
        const out = await new ListCoachRatesHandler(p as never, rbac() as never).execute(
            new ListCoachRatesFeature(WS, 'inv', 'admin', false),
        )
        expect(out.currency).toBe('RUB')
        expect(out.coaches.map((c) => [c.name, c.role, c.updatedAt, c.rates.map((r) => r.effectiveFrom)])).toEqual([
            ['Алла', 'owner', null, []],
            ['Яна', 'coach', '2026-11-05T00:00:00.000Z', ['2026-11', '2026-06']],
        ])
    })
})

describe('SetCoachRateHandler', () => {
    const run = (p: PrismaMock, body = rateBody()) => {
        const s = services()
        const out = new SetCoachRateHandler(p as never, rbac() as never, s.audit as never, s.realtime as never).execute(
            new SetCoachRateFeature(body, WS, COACH, 'inv', 'admin', false),
        )
        return { out, ...s }
    }

    it('creates the rate under the payroll lock, audits and signals', async () => {
        const p = prismaMock()
        const { out, audit, realtime } = run(p)
        const row = await out
        expect(p.$executeRaw).toHaveBeenCalled()
        expect(p.coachRate.create.mock.calls[0][0].data).toMatchObject({
            workspaceId: WS,
            coachId: COACH,
            effectiveFrom: new Date('2026-11-01T00:00:00Z'),
            perClass: 1500,
            perClassMinStudents: 3,
            revenueBp: 1000,
            currency: 'RUB',
            updatedById: 'inv',
        })
        expect(row).toMatchObject({ id: 'r1', effectiveFrom: '2026-11', perClass: 1500 })
        expect(audit.record.mock.calls[0][0]).toMatchObject({
            action: 'payroll.setRate',
            metadata: { coachId: COACH, effectiveFrom: '2026-11', before: null, after: { perClass: 1500 } },
        })
        expect(realtime.invalidate).toHaveBeenCalledWith(WS, ['payroll'])
    })

    it('replaces the rate of the same month and audits the old values', async () => {
        const p = prismaMock()
        p.coachRate.findUnique.mockResolvedValue({
            id: 'r0',
            coachId: COACH,
            effectiveFrom: new Date('2026-11-01T00:00:00Z'),
            fixedMonthly: 0,
            perClass: 1000,
            perClassMinStudents: 1,
            perStudent: 0,
            revenueBp: 0,
            currency: 'RUB',
        })
        const { out, audit } = run(p)
        await out
        expect(p.coachRate.create).not.toHaveBeenCalled()
        expect(p.coachRate.update.mock.calls[0][0].where).toEqual({ id: 'r0' })
        expect(audit.record.mock.calls[0][0].metadata.before).toMatchObject({ perClass: 1000 })
    })

    it('refuses someone who is not on staff (400)', async () => {
        const p = prismaMock()
        p.user.findFirst.mockResolvedValue(null)
        await expect(run(p).out).rejects.toEqual(new BadRequestError({ message: NOT_STAFF_MESSAGE }))
        expect(p.$transaction).not.toHaveBeenCalled()
    })

    it('refuses a month at or before a closed one (409)', async () => {
        const p = prismaMock()
        p.payrollMonth.findFirst.mockResolvedValue({ month: new Date('2026-11-01T00:00:00Z') })
        await expect(run(p).out).rejects.toBeInstanceOf(ConflictError)
        expect(p.payrollMonth.findFirst.mock.calls[0][0].where).toEqual({
            workspaceId: WS,
            month: { gte: new Date('2026-11-01T00:00:00Z') },
        })
        expect(p.coachRate.create).not.toHaveBeenCalled()
    })

    it('refuses a stale form (409 STALE_UPDATE)', async () => {
        const p = prismaMock()
        p.coachRate.count.mockResolvedValue(1)
        await expect(run(p, rateBody({ expectedUpdatedAt: '2026-11-01T00:00:00.000Z' })).out).rejects.toBeInstanceOf(
            StaleUpdateError,
        )
        expect(p.coachRate.count.mock.calls[0][0].where).toEqual({
            workspaceId: WS,
            coachId: COACH,
            updatedAt: { gt: new Date('2026-11-01T00:00:00.000Z') },
        })
    })

    it('limits the values', () => {
        expect(SetCoachRateInputSchema.safeParse({ ...rateBody(), revenueBp: 10001 }).success).toBe(false)
        expect(SetCoachRateInputSchema.safeParse({ ...rateBody(), perClassMinStudents: 101 }).success).toBe(false)
        expect(SetCoachRateInputSchema.safeParse({ ...rateBody(), perClass: -1 }).success).toBe(false)
        expect(SetCoachRateInputSchema.safeParse({ ...rateBody(), effectiveFrom: '2026-13' }).success).toBe(false)
    })
})

describe('AddPayrollAdjustmentHandler', () => {
    const run = (p: PrismaMock, body = adjBody()) => {
        const s = services()
        const out = new AddPayrollAdjustmentHandler(p as never, rbac() as never, s.audit as never, s.realtime as never).execute(
            new AddPayrollAdjustmentFeature(body, WS, 'inv', 'admin', false),
        )
        return { out, ...s }
    }

    it('adds a trimmed adjustment of an open month and audits the amount', async () => {
        const p = prismaMock()
        const { out, audit, realtime } = run(p)
        const row = await out
        expect(p.payrollAdjustment.create.mock.calls[0][0].data).toMatchObject({
            month: new Date('2026-11-01T00:00:00Z'),
            coachId: COACH,
            amount: 5000,
            currency: 'RUB',
            comment: 'Открытый урок',
            createdByName: 'Ольга Кузнецова',
        })
        expect(row).toMatchObject({ month: '2026-11', amount: 5000, createdByName: 'Ольга Кузнецова' })
        expect(audit.record.mock.calls[0][0]).toMatchObject({
            action: 'payroll.addAdjustment',
            metadata: { month: '2026-11', coachId: COACH, amount: 5000 },
        })
        expect(realtime.invalidate).toHaveBeenCalledWith(WS, ['payroll'])
    })

    it('refuses a closed month (409)', async () => {
        const p = prismaMock()
        p.payrollMonth.findUnique.mockResolvedValue({ id: 'pm1' })
        await expect(run(p).out).rejects.toEqual(new ConflictError({ message: MONTH_CLOSED_MESSAGE }))
        expect(p.payrollAdjustment.create).not.toHaveBeenCalled()
    })

    it('refuses a person who neither is on staff nor ran a class that month (400)', async () => {
        const p = prismaMock()
        p.user.findFirst.mockResolvedValue(null)
        await expect(run(p).out).rejects.toBeInstanceOf(BadRequestError)
    })

    it('refuses a zero amount and an empty comment (400 from the pipe)', () => {
        expect(AddPayrollAdjustmentInputSchema.safeParse({ ...adjBody(), amount: 0 }).success).toBe(false)
        expect(AddPayrollAdjustmentInputSchema.safeParse({ ...adjBody(), comment: '  ' }).success).toBe(false)
        expect(AddPayrollAdjustmentInputSchema.safeParse({ ...adjBody(), amount: -10_000_001 }).success).toBe(false)
    })
})

describe('DeletePayrollAdjustmentHandler', () => {
    const run = (p: PrismaMock) => {
        const s = services()
        const out = new DeletePayrollAdjustmentHandler(p as never, rbac() as never, s.audit as never, s.realtime as never).execute(
            new DeletePayrollAdjustmentFeature(WS, 'a1', 'inv', 'admin', false),
        )
        return { out, ...s }
    }

    it('404s an unknown adjustment', async () => {
        await expect(run(prismaMock()).out).rejects.toBeInstanceOf(NotFoundError)
    })

    it('refuses an adjustment of a closed month (409)', async () => {
        const p = prismaMock()
        p.payrollAdjustment.findFirst.mockResolvedValue(adjRow())
        p.payrollMonth.findUnique.mockResolvedValue({ id: 'pm1' })
        await expect(run(p).out).rejects.toBeInstanceOf(ConflictError)
        expect(p.payrollAdjustment.deleteMany).not.toHaveBeenCalled()
    })

    it('deletes and audits what was removed', async () => {
        const p = prismaMock()
        p.payrollAdjustment.findFirst.mockResolvedValue(adjRow())
        const { out, audit } = run(p)
        expect(await out).toEqual({ status: 'deleted' })
        expect(p.payrollAdjustment.deleteMany.mock.calls[0][0].where).toEqual({ id: 'a1', workspaceId: WS })
        expect(audit.record.mock.calls[0][0]).toMatchObject({
            action: 'payroll.deleteAdjustment',
            metadata: { month: '2026-11', amount: 5000, comment: 'Открытый урок' },
        })
    })
})

describe('ClosePayrollMonthHandler', () => {
    const run = (p: PrismaMock, expectedTotal = 1000, month = '2026-10', invoker = 'inv') => {
        const s = services()
        const out = closeHandler(p, s).execute(
            new ClosePayrollMonthFeature({ expectedTotal }, WS, month, invoker, 'admin', false),
        )
        return { out, ...s }
    }

    it('refuses a month that has not ended (400)', async () => {
        const p = prismaMock()
        await expect(run(p, 1000, '2026-11').out).rejects.toEqual(
            new BadRequestError({ message: 'Месяц ещё не закончился' }),
        )
        expect(p.$transaction).not.toHaveBeenCalled()
    })

    it('refuses a malformed month (400)', async () => {
        await expect(run(prismaMock(), 1000, '2026-1').out).rejects.toBeInstanceOf(BadRequestError)
    })

    it('refuses when the recomputed total differs (409 STALE_UPDATE)', async () => {
        const p = prismaMock()
        await expect(run(p, 999).out).rejects.toMatchObject({
            statusCode: 409,
            code: 'STALE_UPDATE',
            message: TOTALS_CHANGED_MESSAGE,
        })
        expect(p.payrollMonth.create).not.toHaveBeenCalled()
    })

    it('refuses when a coach’s total differs though the total matches (409 STALE_UPDATE)', async () => {
        const p = prismaMock()
        const s = services()
        const out = closeHandler(p, s).execute(
            new ClosePayrollMonthFeature(
                { expectedTotal: 1000, expectedLines: [{ coachId: OTHER, total: 1000 }] },
                WS,
                '2026-10',
                'inv',
                'admin',
                false,
            ),
        )
        await expect(out).rejects.toMatchObject({ statusCode: 409, code: 'STALE_UPDATE' })
        expect(p.payrollMonth.create).not.toHaveBeenCalled()
    })

    it('closes when the confirmed lines match', async () => {
        const p = prismaMock()
        const s = services()
        await closeHandler(p, s).execute(
            new ClosePayrollMonthFeature(
                { expectedTotal: 1000, expectedLines: [{ coachId: COACH, total: 1000 }] },
                WS,
                '2026-10',
                'inv',
                'admin',
                false,
            ),
        )
        expect(p.payrollMonth.create).toHaveBeenCalled()
    })

    it('refuses an already closed month (409)', async () => {
        const p = prismaMock()
        p.payrollMonth.findUnique.mockResolvedValue(closedRow())
        await expect(run(p).out).rejects.toEqual(new ConflictError({ message: ALREADY_CLOSED_MESSAGE }))
    })

    it('turns a concurrent close (P2002) into 409 «Месяц уже закрыт»', async () => {
        const p = prismaMock()
        p.payrollMonth.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
        await expect(run(p).out).rejects.toEqual(new ConflictError({ message: ALREADY_CLOSED_MESSAGE }))
    })

    it('freezes the month, audits the total and stays quiet while pay is hidden', async () => {
        const p = prismaMock()
        const { out, audit, realtime, notifications } = run(p)
        await out
        expect(p.$executeRaw).toHaveBeenCalled()
        const data = p.payrollMonth.create.mock.calls[0][0].data
        expect(data).toMatchObject({
            workspaceId: WS,
            month: new Date('2026-10-01T00:00:00Z'),
            total: 1000,
            closedById: 'inv',
            closedByName: 'Ольга Кузнецова',
        })
        expect(data.lines.createMany.data[0]).toMatchObject({ coachId: COACH, fixedAmount: 1000, total: 1000 })
        expect(audit.record.mock.calls[0][0]).toMatchObject({
            action: 'payroll.closeMonth',
            metadata: { month: '2026-10', total: 1000, coaches: 1 },
        })
        expect(realtime.invalidate).toHaveBeenCalledWith(WS, ['payroll'])
        expect(notifications.notifyUser).not.toHaveBeenCalled()
    })

    it('tells each coach with a line who is still on staff (not the closer) — without amounts — when pay is shown', async () => {
        const p = prismaMock()
        p.workspace.findUnique.mockResolvedValue({ timezone: 'Europe/Moscow', coachPayVisible: true })
        liveMock.mockResolvedValue(
            live({
                lines: [line(), line({ coachId: 'inv', name: 'Закрывающий', total: 0 }), line({ coachId: OTHER, total: 0 })],
                total: 1000,
            }),
        )
        // OTHER left the club: the staff query no longer returns them.
        p.user.findMany.mockResolvedValue([{ id: COACH }])
        const { out, notifications } = run(p)
        await out
        const where = p.user.findMany.mock.calls[0][0].where
        expect(where.id).toEqual({ in: [COACH, OTHER] })
        expect(where.OR).toEqual([
            { id: OWNER },
            expect.objectContaining({ workspaceMemberships: expect.anything() }),
        ])
        expect(notifications.notifyUser).toHaveBeenCalledTimes(1)
        const push = notifications.notifyUser.mock.calls[0][0]
        expect(push).toMatchObject({
            userId: COACH,
            kind: 'payroll.closed',
            topic: 'Выплаты за октябрь готовы',
            message: 'Посмотрите в профиле: «Мои выплаты».',
            metadata: { workspaceId: WS, month: '2026-10' },
        })
        expect(JSON.stringify(push)).not.toContain('1000')
    })
})

describe('ReopenPayrollMonthHandler', () => {
    const run = (p: PrismaMock) => {
        const s = services()
        const out = new ReopenPayrollMonthHandler(p as never, rbac() as never, s.audit as never, s.realtime as never).execute(
            new ReopenPayrollMonthFeature({ reason: 'Ошибка в посещаемости' }, WS, '2026-10', 'inv', 'admin', false),
        )
        return { out, ...s }
    }

    it('requires a reason of 3–500 characters', () => {
        expect(ReopenPayrollMonthInputSchema.safeParse({ reason: ' а ' }).success).toBe(false)
        expect(ReopenPayrollMonthInputSchema.safeParse({}).success).toBe(false)
        expect(ReopenPayrollMonthInputSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false)
    })

    it('refuses a month that is not closed (409)', async () => {
        await expect(run(prismaMock()).out).rejects.toBeInstanceOf(ConflictError)
    })

    it('deletes the snapshot and audits the reason with the old totals', async () => {
        const p = prismaMock()
        p.payrollMonth.findUnique.mockResolvedValueOnce(closedRow())
        const { out, audit, realtime } = run(p)
        const view = await out
        expect(p.payrollMonth.delete).toHaveBeenCalledWith({ where: { id: 'pm1' } })
        expect(audit.record.mock.calls[0][0]).toMatchObject({
            action: 'payroll.reopenMonth',
            metadata: {
                month: '2026-10',
                reason: 'Ошибка в посещаемости',
                totalBefore: 1000,
                lines: [{ coachId: COACH, name: 'Анна Тренер', total: 1000 }],
            },
        })
        expect(realtime.invalidate).toHaveBeenCalledWith(WS, ['payroll'])
        expect(view.status).toBe('open')
    })
})

describe('GetMyPayrollHandler', () => {
    const run = (p: PrismaMock, role: string | null, invoker = COACH) =>
        new GetMyPayrollHandler(p as never, rbac() as never).execute(
            new GetMyPayrollFeature(WS, invoker, role, false),
        )

    it('refuses someone who is not staff', async () => {
        await expect(run(prismaMock(), 'user', 'member')).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('refuses a coach while the club hides pay (403)', async () => {
        await expect(run(prismaMock(), 'coach')).rejects.toEqual(new ForbiddenError({ message: PAY_HIDDEN_MESSAGE }))
    })

    it('answers a club admin even while pay is hidden', async () => {
        await expect(run(prismaMock(), 'admin', 'inv')).resolves.toMatchObject({ months: [] })
    })

    it('returns only the invoker’s closed lines and this month’s counts without money', async () => {
        const p = prismaMock()
        p.workspace.findUnique.mockResolvedValue({ timezone: 'Europe/Moscow', coachPayVisible: true })
        const month = new Date('2026-10-01T00:00:00Z')
        p.payrollLine.findMany.mockResolvedValue([
            {
                ...closedRow().lines[0],
                payrollMonth: { month, closedAt: new Date('2026-11-02T10:00:00Z'), currency: 'RUB' },
            },
        ])
        p.payrollAdjustment.findMany.mockResolvedValue([
            adjRow({ month }),
            // In another currency than the frozen month's: it was not paid.
            adjRow({ id: 'a2', month, currency: 'KZT' }),
        ])
        classesMock.mockResolvedValue({
            counted: [cls({ marks: 4 }), cls({ sessionId: 's2', coachId: OTHER, marks: 9 })],
            cancelled: [],
        })
        const out = await run(p, 'coach')
        expect(p.payrollLine.findMany.mock.calls[0][0]).toMatchObject({
            where: { workspaceId: WS, coachId: COACH },
            take: 12,
        })
        expect(p.payrollAdjustment.findMany.mock.calls[0][0].where).toMatchObject({ coachId: COACH })
        expect(out.months).toEqual([
            expect.objectContaining({
                month: '2026-10',
                total: 1000,
                amounts: { fixed: 1000, classes: 0, students: 0, revenue: 0, adjustments: 0 },
                adjustments: [
                    { id: 'a1', amount: 5000, comment: 'Открытый урок', createdAt: '2026-11-20T10:00:00.000Z' },
                ],
            }),
        ])
        expect(out.current).toEqual({ month: '2026-11', classes: 1, marks: 4 })
    })
})
