import {
    autopayAbonementSelect,
    type AutopayAbonementRow,
    autopaySchedule,
} from '../../domains/autopay/autopay-anchor'
import {
    heldSubscriptionWhere,
    sameScope,
    scopeDirectionIds,
} from '../../domains/subscriptions/current-subscriptions'
import { RENEWAL_LAPSED_DAYS } from '../../domains/subscriptions/renewal-rules'
import type { Prisma, PrismaService } from '../../infrastructure/prisma'
import { localDateInTz } from '../attendance/attendance-utils'
import { displayName } from '../attendance/schemas'
import { asNeedsActionReason, LIVE_AUTOPAY_STATUSES } from './member-autopay-view'

const DAY_MS = 24 * 60 * 60 * 1000

// A live agreement as staff lists read it («Продлить», «Автоплатёж не
// прошёл», the AI tool): no money, no card.
export type AutopayStatus = {
    autopayId: string
    planId: string | null
    // The tariff's scope: the agreement renews the member's abonement of it.
    scope: string[]
    status: 'ACTIVE' | 'NEEDS_ACTION'
    // Club-local day of the next charge (the retry day while declines are
    // pending); null when stopped or nothing is due yet.
    nextChargeOn: string | null
}

// The live agreements of these members, by member (oldest first), with
// their next charge day from the member's abonements (domains/autopay rules).
export const loadAutopayStatuses = async (
    prisma: PrismaService,
    p: { workspaceId: string; userIds: readonly string[]; now: Date },
): Promise<Map<string, AutopayStatus[]>> => {
    const byUser = new Map<string, AutopayStatus[]>()
    if (p.userIds.length === 0) return byUser
    const rows = await prisma.memberAutopay.findMany({
        where: {
            workspaceId: p.workspaceId,
            userId: { in: [...p.userIds] },
            status: { in: [...LIVE_AUTOPAY_STATUSES] },
        },
        select: {
            id: true,
            userId: true,
            planId: true,
            status: true,
            failedAttempts: true,
            nextAttemptAt: true,
            plan: { select: { directions: { select: { directionId: true } } } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    if (rows.length === 0) return byUser

    const owners = [...new Set(rows.map((r) => r.userId))]
    const [workspace, subs] = await Promise.all([
        prisma.workspace.findUnique({
            where: { id: p.workspaceId },
            select: { timezone: true },
        }),
        prisma.subscription.findMany({
            where: {
                ...heldSubscriptionWhere,
                workspaceId: p.workspaceId,
                workspaceMember: { userId: { in: owners } },
                OR: [
                    { endDate: null },
                    { endDate: { gt: new Date(p.now.getTime() - RENEWAL_LAPSED_DAYS * DAY_MS) } },
                ],
            },
            select: { ...autopayAbonementSelect, workspaceMember: { select: { userId: true } } },
        }),
    ])
    const tz = workspace?.timezone ?? 'UTC'
    const subsByUser = new Map<string, AutopayAbonementRow[]>()
    for (const s of subs) {
        const userId = s.workspaceMember?.userId
        if (!userId) continue
        subsByUser.set(userId, [...(subsByUser.get(userId) ?? []), s])
    }
    for (const r of rows) {
        const scope = r.plan ? scopeDirectionIds(r.plan) : []
        const status = r.status === 'NEEDS_ACTION' ? 'NEEDS_ACTION' : 'ACTIVE'
        const nextChargeOn =
            status !== 'ACTIVE' || !r.plan
                ? null
                : r.failedAttempts > 0 && r.nextAttemptAt
                  ? localDateInTz(r.nextAttemptAt, tz)
                  : (autopaySchedule(subsByUser.get(r.userId) ?? [], scope, tz, p.now).nextCharge
                        ?.on ?? null)
        byUser.set(r.userId, [
            ...(byUser.get(r.userId) ?? []),
            { autopayId: r.id, planId: r.planId, scope, status, nextChargeOn },
        ])
    }
    return byUser
}

// The member's agreement renewing an abonement of this scope (null: none).
export const autopayForScope = (
    statuses: readonly AutopayStatus[] | undefined,
    scope: readonly string[],
): AutopayStatus | null => statuses?.find((a) => sameScope(a.scope, scope)) ?? null

// «Автоплатёж не прошёл» in «Удержание → Продлить»: stopped agreements and
// active ones with declines pending — of current members in the caller's
// scope, oldest first. No amount; never part of «Ожидают оплаты» (no debt is
// created: docs/design/2026-11-15-member-autopay.md §1, §12).
export const AUTOPAY_ATTENTION_CAP = 50

export const loadAutopayAttention = async (
    prisma: PrismaService,
    p: { workspaceId: string; memberWhere: Prisma.WorkspaceMemberWhereInput },
) => {
    const where: Prisma.MemberAutopayWhereInput = {
        workspaceId: p.workspaceId,
        OR: [{ status: 'NEEDS_ACTION' }, { status: 'ACTIVE', failedAttempts: { gt: 0 } }],
        user: {
            workspaceMemberships: { some: { workspaceId: p.workspaceId, ...p.memberWhere } },
        },
    }
    const [total, rows, workspace] = await Promise.all([
        prisma.memberAutopay.count({ where }),
        prisma.memberAutopay.findMany({
            where,
            orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
            take: AUTOPAY_ATTENTION_CAP,
            select: {
                id: true,
                userId: true,
                planName: true,
                status: true,
                needsActionReason: true,
                lastError: true,
                nextAttemptAt: true,
                updatedAt: true,
                user: { select: { firstname: true, lastname: true, email: true } },
            },
        }),
        prisma.workspace.findUnique({
            where: { id: p.workspaceId },
            select: { timezone: true },
        }),
    ])
    const tz = workspace?.timezone ?? 'UTC'
    return {
        total,
        data: rows.map((r) => ({
            autopayId: r.id,
            member: { userId: r.userId, name: displayName(r.user) },
            planName: r.planName,
            // null while active with declines pending (lastError says why).
            reason: r.status === 'NEEDS_ACTION' ? asNeedsActionReason(r.needsActionReason) : null,
            lastError: r.lastError,
            // null = stopped, waits for the member («ждёт ученика»).
            nextAttemptOn:
                r.status === 'ACTIVE' && r.nextAttemptAt ? localDateInTz(r.nextAttemptAt, tz) : null,
            since: r.updatedAt.toISOString(),
        })),
    }
}
