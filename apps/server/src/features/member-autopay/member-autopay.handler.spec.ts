import 'reflect-metadata'

import { ALLOW_EXPIRED_ACCESS } from '../../shared/decorators/allow-expired-access.decorator'
import { ALLOW_SUSPENDED_WORKSPACE } from '../../shared/decorators/allow-suspended-workspace.decorator'
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { AUTOPAY_CONSENT_VERSION } from '../../domains/autopay/autopay-consent'
import { RbacService } from '../../shared/services/rbac.service'
import { AcceptMyAutopayTermsFeature } from './accept-my-autopay-terms.feature'
import { AcceptMyAutopayTermsHandler } from './accept-my-autopay-terms.handler'
import { CancelMemberAutopayFeature } from './cancel-member-autopay.feature'
import { CancelMemberAutopayHandler } from './cancel-member-autopay.handler'
import { CancelMyAutopayFeature } from './cancel-my-autopay.feature'
import { CancelMyAutopayHandler } from './cancel-my-autopay.handler'
import { ListMemberAutopaysFeature } from './list-member-autopays.feature'
import { ListMemberAutopaysHandler } from './list-member-autopays.handler'
import { ListMyAutopaysFeature } from './list-my-autopays.feature'
import { ListMyAutopaysHandler } from './list-my-autopays.handler'
import { MemberAutopaysController } from './member-autopays.controller'
import { MyAutopaysController } from './my-autopays.controller'

// 12:00 in Moscow, inside the club's charge window.
const NOW = new Date('2026-11-15T09:00:00Z')
const DAY = 24 * 60 * 60 * 1000

// The member's current abonement of the tariff's scope (club-wide): ends at
// the start of 15 Dec Moscow, so the renewal starts 15 Dec and the charge is
// due 14 Dec 10:00.
const ANCHOR = {
    id: 's1',
    status: 'ACTIVE',
    startDate: new Date('2026-11-14T21:00:00Z'),
    endDate: new Date('2026-12-14T21:00:00Z'),
    classesTotal: null,
    classesRemaining: null,
    durationDays: 30,
    createdAt: new Date('2026-11-14T09:00:00Z'),
    updatedAt: new Date('2026-11-14T09:00:00Z'),
    directions: [],
    consumedRecords: [],
    burnedBookings: [],
}

const PLAN = {
    id: 'p1',
    price: 4000,
    currency: 'RUB',
    durationDays: 30,
    classCount: null,
    directions: [],
}

type Agreement = Record<string, unknown> & { id: string; userId: string; status: string }

const agreement = (over: Partial<Agreement> = {}): Agreement => ({
    id: 'a1',
    workspaceId: 'w1',
    userId: 'u1',
    planId: 'p1',
    planName: 'Безлимит',
    status: 'ACTIVE',
    needsActionReason: null,
    cardLast4: '4444',
    termsAmount: 4000,
    currency: 'RUB',
    termsDurationDays: 30,
    termsClassCount: null,
    consentVersion: AUTOPAY_CONSENT_VERSION,
    consentedAt: new Date('2026-11-14T09:00:00Z'),
    failedAttempts: 0,
    nextAttemptAt: null,
    lastError: null,
    cancelledAt: null,
    cancelSource: null,
    cancelledById: null,
    cancelReason: null,
    createdAt: new Date('2026-11-14T09:00:00Z'),
    updatedAt: new Date('2026-11-14T09:00:00Z'),
    plan: PLAN,
    ...over,
})

// One club (owner «owner», Moscow), its agreements and the member's
// abonements. The fake answers like the database would for the queries the
// handlers make: rows filtered by club, member and id.
const make = (o: { rows?: Agreement[]; member?: boolean; failures?: unknown[] } = {}) => {
    let rows = o.rows ?? [agreement()]
    const matches = (r: Agreement, where: Record<string, unknown>) =>
        (where.id === undefined || r.id === where.id) &&
        (where.userId === undefined || r.userId === where.userId) &&
        (where.workspaceId === undefined || r.workspaceId === where.workspaceId)
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({
                ownerId: 'owner',
                coachSeesAllGroups: true,
                timezone: 'Europe/Moscow',
            }),
        },
        workspaceMember: {
            findFirst: jest.fn().mockResolvedValue(o.member === false ? null : { id: 'm1' }),
        },
        memberAutopay: {
            findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
                rows.filter((r) => matches(r, where)),
            ),
            findFirst: jest.fn(
                async ({ where }: { where: Record<string, unknown> }) =>
                    rows.find((r) => matches(r, where)) ?? null,
            ),
            updateMany: jest.fn(
                async ({
                    where,
                    data,
                }: {
                    where: { id: string; status: string; updatedAt: Date }
                    data: Record<string, unknown>
                }) => {
                    const hit = rows.find(
                        (r) =>
                            r.id === where.id &&
                            r.status === where.status &&
                            (r.updatedAt as Date).getTime() === where.updatedAt.getTime(),
                    )
                    if (!hit) return { count: 0 }
                    rows = rows.map((r) =>
                        r === hit ? { ...r, ...data, updatedAt: new Date() } : r,
                    )
                    return { count: 1 }
                },
            ),
        },
        payment: { findMany: jest.fn().mockResolvedValue(o.failures ?? []) },
        subscription: { findMany: jest.fn().mockResolvedValue([ANCHOR]) },
        // No family discount in this club.
        discount: { findFirst: jest.fn().mockResolvedValue(null) },
        user: {
            findMany: jest
                .fn()
                .mockResolvedValue([{ id: 'hc1', firstname: 'Олег', lastname: 'Тренеров', email: null }]),
        },
    }
    // The agreements writer: cancelling is its job (token wipe, audit, notice).
    const agreements = {
        cancel: jest.fn(async (p: { id: string; source: string; actorId?: string; reason?: string }) => {
            rows = rows.map((r) =>
                r.id === p.id
                    ? {
                          ...r,
                          status: 'CANCELLED',
                          cancelledAt: NOW,
                          cancelSource: p.source,
                          cancelledById: p.source === 'STAFF' ? (p.actorId ?? null) : null,
                          cancelReason: p.reason ?? null,
                      }
                    : r,
            )
            return null
        }),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const rbac = new RbacService(prisma as never)
    return { prisma, agreements, audit, rbac, rows: () => rows }
}

beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
})
afterEach(() => {
    jest.useRealTimers()
})

describe('listMyAutopays', () => {
    const list = (m: ReturnType<typeof make>, userId = 'u1') =>
        new ListMyAutopaysHandler(m.prisma as never).execute(new ListMyAutopaysFeature('w1', userId))

    it('shows the member their own agreement with the next charge and the card', async () => {
        const m = make()
        const { data } = await list(m)
        expect(data).toEqual([
            {
                id: 'a1',
                planId: 'p1',
                planName: 'Безлимит',
                status: 'ACTIVE',
                needsActionReason: null,
                cardLabel: 'карта •• 4444',
                termsAmount: 4000,
                currency: 'RUB',
                termsDurationDays: 30,
                termsClassCount: null,
                nextCharge: { on: '2026-12-14', amount: 4000, kind: 'term' },
                lastError: null,
                lastFailedOn: null,
                nextAttemptOn: null,
                newTerms: null,
                consentedAt: '2026-11-14T09:00:00.000Z',
                cancelledAt: null,
                cancelSource: null,
                cancelReason: null,
            },
        ])
        const where = m.prisma.memberAutopay.findMany.mock.calls[0][0].where
        expect(where).toMatchObject({ workspaceId: 'w1', userId: 'u1' })
        // Live ones plus those cancelled in the last 30 days (the confirmation).
        expect(where.OR[0]).toEqual({ status: { in: ['ACTIVE', 'NEEDS_ACTION'] } })
        expect(where.OR[1].cancelledAt.gte).toEqual(new Date(NOW.getTime() - 30 * DAY))
    })

    it('never shows another member’s agreement', async () => {
        const { data } = await list(make(), 'u2')
        expect(data).toEqual([])
    })

    it('holds the charge and shows the new terms when the price rose', async () => {
        const m = make({ rows: [agreement({ plan: { ...PLAN, price: 4500 } })] })
        const [a] = (await list(m)).data
        expect(a.nextCharge).toBeNull()
        expect(a.newTerms).toEqual({
            amount: 4500,
            durationDays: 30,
            classCount: null,
            consentVersion: AUTOPAY_CONSENT_VERSION,
        })
    })

    it('charges a lower price without asking', async () => {
        const m = make({ rows: [agreement({ plan: { ...PLAN, price: 3500 } })] })
        const [a] = (await list(m)).data
        expect(a.newTerms).toBeNull()
        expect(a.nextCharge).toEqual({ on: '2026-12-14', amount: 3500, kind: 'term' })
    })

    it('shows a pending decline: when it failed, why, and the retry day', async () => {
        const m = make({
            rows: [
                agreement({
                    failedAttempts: 1,
                    lastError: 'недостаточно средств',
                    nextAttemptAt: new Date('2026-12-15T07:00:00Z'),
                }),
            ],
            failures: [{ autopayId: 'a1', updatedAt: new Date('2026-12-14T07:05:00Z') }],
        })
        const [a] = (await list(m)).data
        expect(a).toMatchObject({
            lastError: 'недостаточно средств',
            lastFailedOn: '2026-12-14',
            nextAttemptOn: '2026-12-15',
            nextCharge: { on: '2026-12-15', amount: 4000, kind: 'term' },
        })
        expect(m.prisma.payment.findMany.mock.calls[0][0].where).toEqual({
            autopayId: { in: ['a1'] },
            status: 'CANCELED',
        })
    })

    it('has nothing due for a stopped agreement, and only the record for a cancelled one', async () => {
        const m = make({
            rows: [
                agreement({ status: 'NEEDS_ACTION', needsActionReason: 'CARD_EXPIRED' }),
                agreement({
                    id: 'a0',
                    status: 'CANCELLED',
                    cardLast4: null,
                    cancelledAt: new Date('2026-11-10T09:00:00Z'),
                    cancelSource: 'SYSTEM',
                    cancelReason: 'клуб отключил автоплатежи',
                }),
            ],
        })
        const [stopped, cancelled] = (await list(m)).data
        expect(stopped).toMatchObject({ needsActionReason: 'CARD_EXPIRED', nextCharge: null })
        expect(cancelled).toMatchObject({
            status: 'CANCELLED',
            cardLabel: 'сохранённый способ оплаты',
            cancelSource: 'SYSTEM',
            cancelReason: 'клуб отключил автоплатежи',
            cancelledAt: '2026-11-10T09:00:00.000Z',
            nextCharge: null,
            newTerms: null,
        })
    })
})

describe('cancelMyAutopay', () => {
    const cancel = (m: ReturnType<typeof make>, userId = 'u1', id = 'a1') =>
        new CancelMyAutopayHandler(m.prisma as never, m.agreements as never).execute(
            new CancelMyAutopayFeature('w1', id, userId),
        )

    it('stops the member’s own agreement at once (the writer wipes the token and confirms)', async () => {
        const m = make()
        const out = await cancel(m)
        expect(m.agreements.cancel).toHaveBeenCalledWith({ id: 'a1', source: 'MEMBER', actorId: 'u1' })
        expect(out).toMatchObject({ status: 'CANCELLED', cancelSource: 'MEMBER', nextCharge: null })
    })

    it('is a 404 for another member’s agreement or another club’s', async () => {
        const m = make()
        await expect(cancel(m, 'u2')).rejects.toBeInstanceOf(NotFoundError)
        await expect(cancel(m, 'u1', 'a-other')).rejects.toBeInstanceOf(NotFoundError)
        expect(m.prisma.memberAutopay.findFirst.mock.calls[0][0].where).toEqual({
            id: 'a1',
            workspaceId: 'w1',
            userId: 'u2',
        })
        expect(m.agreements.cancel).not.toHaveBeenCalled()
    })

    it('is idempotent: an already cancelled agreement answers itself', async () => {
        const m = make({ rows: [agreement({ status: 'CANCELLED', cancelledAt: NOW, cancelSource: 'MEMBER' })] })
        await expect(cancel(m)).resolves.toMatchObject({ status: 'CANCELLED' })
        expect(m.agreements.cancel).not.toHaveBeenCalled()
    })
})

describe('acceptMyAutopayTerms', () => {
    const accept = (
        m: ReturnType<typeof make>,
        payload: Partial<{ amount: number; durationDays: number; classCount: number | null; consentVersion: string }> = {},
        userId = 'u1',
    ) =>
        new AcceptMyAutopayTermsHandler(m.prisma as never, m.audit as never).execute(
            new AcceptMyAutopayTermsFeature(
                { amount: 4500, durationDays: 30, classCount: null, consentVersion: AUTOPAY_CONSENT_VERSION, ...payload },
                'w1',
                'a1',
                userId,
            ),
        )
    const risen = (over: Partial<Agreement> = {}) =>
        make({ rows: [agreement({ plan: { ...PLAN, price: 4500 }, ...over })] })

    it('accepts the rise the screen showed and lifts a TERMS_CHANGED stop', async () => {
        const m = risen({ status: 'NEEDS_ACTION', needsActionReason: 'TERMS_CHANGED', failedAttempts: 1 })
        const out = await accept(m)
        const call = m.prisma.memberAutopay.updateMany.mock.calls[0][0]
        expect(call.where).toEqual({
            id: 'a1',
            status: 'NEEDS_ACTION',
            updatedAt: new Date('2026-11-14T09:00:00Z'),
        })
        expect(call.data).toEqual({
            termsAmount: 4500,
            termsDurationDays: 30,
            termsClassCount: null,
            currency: 'RUB',
            consentVersion: AUTOPAY_CONSENT_VERSION,
            consentedAt: NOW,
            status: 'ACTIVE',
            needsActionReason: null,
        })
        // Declines in a row are kept.
        expect(m.rows()[0].failedAttempts).toBe(1)
        expect(out).toMatchObject({
            status: 'ACTIVE',
            termsAmount: 4500,
            newTerms: null,
            nextCharge: { on: '2026-12-14', amount: 4500 },
        })
        expect(m.audit.record).toHaveBeenCalledWith({
            action: 'autopay.termsAccepted',
            targetType: 'member',
            targetId: 'u1',
            workspaceId: 'w1',
            actorId: 'u1',
            metadata: {
                autopayId: 'a1',
                planName: 'Безлимит',
                from: { amount: 4000, durationDays: 30, classCount: null },
                to: { amount: 4500, durationDays: 30, classCount: null },
                consentVersion: AUTOPAY_CONSENT_VERSION,
            },
        })
    })

    it('accepts a pending rise while still active (status unchanged)', async () => {
        const m = risen()
        await accept(m)
        const data = m.prisma.memberAutopay.updateMany.mock.calls[0][0].data
        expect(data).not.toHaveProperty('status')
        expect(data.termsAmount).toBe(4500)
    })

    it('is a 409 when the terms changed again since the screen', async () => {
        const m = risen()
        await expect(accept(m, { amount: 4200 })).rejects.toThrow(
            new ConflictError({ message: 'Условия снова изменились — обновите экран' }),
        )
        await expect(accept(m, { durationDays: 28 })).rejects.toBeInstanceOf(ConflictError)
        expect(m.prisma.memberAutopay.updateMany).not.toHaveBeenCalled()
    })

    it('is a 409 with nothing to accept, and when another write won the race', async () => {
        await expect(accept(make())).rejects.toBeInstanceOf(ConflictError)
        const raced = risen()
        raced.prisma.memberAutopay.updateMany.mockResolvedValueOnce({ count: 0 })
        await expect(accept(raced)).rejects.toBeInstanceOf(ConflictError)
        expect(raced.audit.record).not.toHaveBeenCalled()
    })

    it('refuses a stale consent text with 400', async () => {
        await expect(accept(risen(), { consentVersion: '2026-01-01' })).rejects.toBeInstanceOf(
            BadRequestError,
        )
    })

    it('is a 409 on a cancelled agreement and a 404 on another member’s', async () => {
        await expect(
            accept(risen({ status: 'CANCELLED', cancelledAt: NOW })),
        ).rejects.toThrow('Автоплатёж уже отключён')
        await expect(accept(risen(), {}, 'u2')).rejects.toBeInstanceOf(NotFoundError)
    })
})

describe('listMemberAutopays (member card)', () => {
    const list = (m: ReturnType<typeof make>, caller: { userId: string; role: string | null }) =>
        new ListMemberAutopaysHandler(m.prisma as never, m.rbac).execute(
            new ListMemberAutopaysFeature('w1', 'u1', caller.userId, caller.role, false),
        )
    const cancelledByStaff = agreement({
        id: 'a0',
        status: 'CANCELLED',
        cancelledAt: new Date('2026-11-12T09:00:00Z'),
        cancelSource: 'STAFF',
        cancelledById: 'hc1',
        cancelReason: 'Попросил по телефону',
    })

    it('shows club admins the amounts and the card, and who cancelled', async () => {
        const m = make({ rows: [agreement(), cancelledByStaff] })
        const { data } = await list(m, { userId: 'adm', role: 'admin' })
        expect(data[0]).toMatchObject({
            cardLabel: 'карта •• 4444',
            termsAmount: 4000,
            nextCharge: { on: '2026-12-14', amount: 4000, kind: 'term' },
            cancelledBy: null,
            createdAt: '2026-11-14T09:00:00.000Z',
        })
        expect(data[1]).toMatchObject({
            cancelSource: 'STAFF',
            cancelReason: 'Попросил по телефону',
            cancelledBy: { userId: 'hc1', name: 'Олег Тренеров' },
        })
    })

    it('strips money and the card for a head coach (server-side)', async () => {
        const m = make({ rows: [agreement({ plan: { ...PLAN, price: 4500 } })] })
        const [a] = (await list(m, { userId: 'hc1', role: 'head_coach' })).data
        expect(a.cardLabel).toBeNull()
        expect(a.termsAmount).toBeNull()
        expect(a.newTerms).toEqual({ amount: null, durationDays: 30, classCount: null, consentVersion: AUTOPAY_CONSENT_VERSION })
        expect(JSON.stringify(a)).not.toContain('4444')
    })

    it('lets the owner in whatever their member row says', async () => {
        const m = make()
        const [a] = (await list(m, { userId: 'owner', role: 'coach' })).data
        expect(a.termsAmount).toBe(4000)
    })

    it('refuses a coach', async () => {
        const m = make()
        await expect(list(m, { userId: 'c1', role: 'coach' })).rejects.toBeInstanceOf(ForbiddenError)
        expect(m.prisma.memberAutopay.findMany).not.toHaveBeenCalled()
    })

    it('is a 404 for someone neither in the club nor with an agreement here', async () => {
        const m = make({ rows: [], member: false })
        await expect(list(m, { userId: 'adm', role: 'admin' })).rejects.toBeInstanceOf(NotFoundError)
    })
})

describe('cancelMemberAutopay (at the member’s request)', () => {
    const cancel = (
        m: ReturnType<typeof make>,
        caller: { userId: string; role: string | null },
        id = 'a1',
    ) =>
        new CancelMemberAutopayHandler(m.prisma as never, m.rbac, m.agreements as never).execute(
            new CancelMemberAutopayFeature(
                { reason: 'Попросил по телефону' },
                'w1',
                id,
                caller.userId,
                caller.role,
                false,
            ),
        )

    it('lets a head coach stop it with the reason (no money in the answer)', async () => {
        const m = make()
        const out = await cancel(m, { userId: 'hc1', role: 'head_coach' })
        expect(m.agreements.cancel).toHaveBeenCalledWith({
            id: 'a1',
            source: 'STAFF',
            actorId: 'hc1',
            reason: 'Попросил по телефону',
        })
        expect(out).toMatchObject({
            status: 'CANCELLED',
            cancelSource: 'STAFF',
            cancelReason: 'Попросил по телефону',
            cancelledBy: { userId: 'hc1', name: 'Олег Тренеров' },
            termsAmount: null,
            cardLabel: null,
        })
    })

    it('refuses a coach before reading the agreement', async () => {
        const m = make()
        await expect(cancel(m, { userId: 'c1', role: 'coach' })).rejects.toBeInstanceOf(ForbiddenError)
        expect(m.prisma.memberAutopay.findFirst).not.toHaveBeenCalled()
        expect(m.agreements.cancel).not.toHaveBeenCalled()
    })

    it('is a 404 for an agreement of another club', async () => {
        const m = make({ rows: [agreement({ workspaceId: 'w2' })] })
        await expect(cancel(m, { userId: 'adm', role: 'admin' })).rejects.toBeInstanceOf(NotFoundError)
        expect(m.agreements.cancel).not.toHaveBeenCalled()
    })

    it('is idempotent', async () => {
        const m = make({
            rows: [agreement({ status: 'CANCELLED', cancelledAt: NOW, cancelSource: 'MEMBER' })],
        })
        await expect(cancel(m, { userId: 'owner', role: null })).resolves.toMatchObject({
            status: 'CANCELLED',
            termsAmount: 4000,
        })
        expect(m.agreements.cancel).not.toHaveBeenCalled()
    })
})

// 376-ФЗ: a member whose access ran out — or whose club is suspended — must
// still see and refuse autopay; accepting new terms works after access ran
// out (the renewal is how it comes back), not in a suspended club.
describe('routes', () => {
    // The guards read this metadata off the route handler.
    const has = (key: string, handler: object) => Reflect.getMetadata(key, handler) === true

    it('keeps the member routes open after access ran out, the refusal in a suspended club too', () => {
        const proto = MyAutopaysController.prototype
        expect(has(ALLOW_EXPIRED_ACCESS, proto.listMyAutopays)).toBe(true)
        expect(has(ALLOW_EXPIRED_ACCESS, proto.cancelMyAutopay)).toBe(true)
        expect(has(ALLOW_EXPIRED_ACCESS, proto.acceptMyAutopayTerms)).toBe(true)
        expect(has(ALLOW_SUSPENDED_WORKSPACE, proto.listMyAutopays)).toBe(true)
        expect(has(ALLOW_SUSPENDED_WORKSPACE, proto.cancelMyAutopay)).toBe(true)
        expect(has(ALLOW_SUSPENDED_WORKSPACE, proto.acceptMyAutopayTerms)).toBe(false)
        expect(has(ALLOW_EXPIRED_ACCESS, MemberAutopaysController.prototype.cancelMemberAutopay)).toBe(false)
    })
})
