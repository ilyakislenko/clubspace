import { Injectable } from '@nestjs/common'

import { localDateInTz } from '../../../features/attendance/attendance-utils'
import {
    PrismaService,
    type PrismaTransactionClientType,
    type Subscription,
    type SubscriptionFreeze,
} from '../../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../../shared/errors/shared.errors'
import {
    addDaysYmd,
    DAY_MS,
    formatFreezeRange,
    planFreezeEnd,
    validateFreezeWindow,
    ymdToDbDate,
} from '../freeze-dates'

const CHANGED_MESSAGE =
    'Абонемент только что изменился — обновите страницу и попробуйте ещё раз'

export type CreateFreezeParams = {
    workspaceId: string
    // The member (User.id), not WorkspaceMember.id.
    userId: string
    subscriptionId: string
    days: number
    // Club-local YYYY-MM-DD; defaults to today in the club timezone.
    fromDate?: string
    reason?: string | null
    now?: Date
}

export type FreezeSubscriptionRow = Subscription & { plan: { name: string } }

export type CreateFreezeResult = {
    freeze: SubscriptionFreeze
    subscription: FreezeSubscriptionRow
    accessUntil: Date | null
}

export type EndFreezeResult = {
    // null when the freeze had not started and the row was removed.
    freeze: SubscriptionFreeze | null
    removed: boolean
    returnedDays: number
    original: { fromDate: Date; untilDate: Date }
    subscription: FreezeSubscriptionRow
    accessUntil: Date | null
}

type FreezeMember = { id: string; accessUntil: Date | null }

// The first freeze of the abonement that has not finished yet (running or upcoming).
export const findOpenFreeze = (
    db: PrismaTransactionClientType,
    p: { subscriptionId: string; todayYmd: string },
) =>
    db.subscriptionFreeze.findFirst({
        where: {
            subscriptionId: p.subscriptionId,
            untilDate: { gte: ymdToDbDate(p.todayYmd) },
        },
        orderBy: { fromDate: 'asc' },
    })

// The freeze that covers a given club-local day, if any.
export const findFreezeOn = (
    db: PrismaTransactionClientType,
    p: { subscriptionId: string; dayYmd: string },
) =>
    db.subscriptionFreeze.findFirst({
        where: {
            subscriptionId: p.subscriptionId,
            fromDate: { lte: ymdToDbDate(p.dayYmd) },
            untilDate: { gte: ymdToDbDate(p.dayYmd) },
        },
    })

// Gives the unused days of one freeze back to the abonement (and to accessUntil
// when creating the freeze had moved it), then removes or shrinks the row.
// Returns the new dates so a caller looping over several freezes can chain them.
const applyFreezeEndInTx = async (
    tx: PrismaTransactionClientType,
    p: {
        freeze: SubscriptionFreeze
        subscription: { id: string; endDate: Date | null }
        member: FreezeMember | null
        todayYmd: string
        now: Date
    },
) => {
    const plan = planFreezeEnd(p.freeze, p.todayYmd)
    if (plan.kind === 'finished') {
        throw new BadRequestError({ message: 'Заморозка уже закончилась' })
    }
    const giveBackMs = plan.returnDays * DAY_MS

    let endDate = p.subscription.endDate
    if (endDate) {
        const next = new Date(endDate.getTime() - giveBackMs)
        const res = await tx.subscription.updateMany({
            where: { id: p.subscription.id, status: 'ACTIVE', endDate },
            data: { endDate: next },
        })
        if (res.count !== 1) {
            throw new BadRequestError({ message: CHANGED_MESSAGE })
        }
        endDate = next
    }

    let accessUntil = p.member?.accessUntil ?? null
    if (p.freeze.accessShifted && p.member && accessUntil) {
        accessUntil = new Date(accessUntil.getTime() - giveBackMs)
        await tx.workspaceMember.update({
            where: { id: p.member.id },
            data: { accessUntil },
        })
    }

    if (plan.kind === 'remove') {
        await tx.subscriptionFreeze.delete({ where: { id: p.freeze.id } })
        return {
            freeze: null,
            returnedDays: plan.returnDays,
            endDate,
            accessUntil,
        }
    }
    const freeze = await tx.subscriptionFreeze.update({
        where: { id: p.freeze.id },
        data: { untilDate: ymdToDbDate(plan.untilYmd), endedEarlyAt: p.now },
    })
    return { freeze, returnedDays: plan.returnDays, endDate, accessUntil }
}

// Cancelling an abonement drops its open freezes and gives the unused days
// back, so access never ends up shorter than before the freeze. Returns the
// number of days given back.
export const releaseOpenFreezesInTx = async (
    tx: PrismaTransactionClientType,
    p: {
        subscription: {
            id: string
            endDate: Date | null
            workspace: { timezone: string }
            workspaceMember: FreezeMember | null
        }
        now: Date
    },
): Promise<number> => {
    const sub = p.subscription
    const todayYmd = localDateInTz(p.now, sub.workspace.timezone)
    const open = await tx.subscriptionFreeze.findMany({
        where: {
            subscriptionId: sub.id,
            untilDate: { gte: ymdToDbDate(todayYmd) },
        },
        orderBy: { fromDate: 'asc' },
    })
    let endDate = sub.endDate
    let member = sub.workspaceMember
    let returned = 0
    for (const freeze of open) {
        const res = await applyFreezeEndInTx(tx, {
            freeze,
            subscription: { id: sub.id, endDate },
            member,
            todayYmd,
            now: p.now,
        })
        endDate = res.endDate
        if (member) member = { id: member.id, accessUntil: res.accessUntil }
        returned += res.returnedDays
    }
    return returned
}

// Pauses an abonement's clock: club-local days, both ends inclusive. The
// freeze moves Subscription.endDate (and accessUntil when it tracked the
// abonement) forward by its length, so every date-driven reader keeps working.
@Injectable()
export class SubscriptionFreezeService {
    constructor(private readonly prisma: PrismaService) {}

    async create(p: CreateFreezeParams): Promise<CreateFreezeResult> {
        return this.prisma.$transaction((tx) => this.createInTx(tx, p))
    }

    async createInTx(
        tx: PrismaTransactionClientType,
        p: CreateFreezeParams,
    ): Promise<CreateFreezeResult> {
        const sub = await tx.subscription.findFirst({
            where: {
                id: p.subscriptionId,
                workspaceId: p.workspaceId,
                workspaceMember: { userId: p.userId },
            },
            select: {
                id: true,
                status: true,
                startDate: true,
                endDate: true,
                workspace: { select: { timezone: true } },
                workspaceMember: {
                    select: {
                        id: true,
                        userId: true,
                        subscriptionId: true,
                        accessUntil: true,
                    },
                },
            },
        })
        // Also covers the owner, who has no member row and so no abonement.
        if (!sub || !sub.workspaceMember) {
            throw new NotFoundError({ message: 'Абонемент не найден' })
        }
        const member = sub.workspaceMember
        if (member.subscriptionId !== sub.id) {
            throw new BadRequestError({
                message: 'Заморозить можно только текущий абонемент участника',
            })
        }

        const now = p.now ?? new Date()
        const tz = sub.workspace.timezone
        const todayYmd = localDateInTz(now, tz)
        const fromYmd = p.fromDate ?? todayYmd

        const refusal = validateFreezeWindow({
            fromYmd,
            todayYmd,
            days: p.days,
            timezone: tz,
            now,
            subscription: sub,
        })
        if (refusal) throw new BadRequestError({ message: refusal })

        const open = await findOpenFreeze(tx, {
            subscriptionId: sub.id,
            todayYmd,
        })
        if (open) {
            throw new BadRequestError({
                message: `У абонемента уже есть заморозка ${formatFreezeRange(open)}. Снимите её, чтобы назначить новую`,
            })
        }

        // validateFreezeWindow already refused a null endDate.
        const oldEnd = sub.endDate as Date
        const shiftMs = p.days * DAY_MS
        const res = await tx.subscription.updateMany({
            where: { id: sub.id, status: 'ACTIVE', endDate: oldEnd },
            data: { endDate: new Date(oldEnd.getTime() + shiftMs) },
        })
        if (res.count !== 1) {
            throw new BadRequestError({ message: CHANGED_MESSAGE })
        }

        // Access tracks the abonement (or runs past it): move it along. A null
        // (unlimited) or deliberately shorter manual date stays as it is.
        const accessShifted =
            member.accessUntil !== null && member.accessUntil >= oldEnd
        let accessUntil = member.accessUntil
        if (accessShifted && accessUntil) {
            accessUntil = new Date(accessUntil.getTime() + shiftMs)
            await tx.workspaceMember.update({
                where: { id: member.id },
                data: { accessUntil },
            })
        }

        const freeze = await tx.subscriptionFreeze.create({
            data: {
                workspaceId: p.workspaceId,
                subscriptionId: sub.id,
                userId: member.userId,
                fromDate: ymdToDbDate(fromYmd),
                untilDate: ymdToDbDate(addDaysYmd(fromYmd, p.days - 1)),
                reason: p.reason?.trim() || null,
                accessShifted,
            },
        })
        const subscription = await tx.subscription.findUniqueOrThrow({
            where: { id: sub.id },
            include: { plan: { select: { name: true } } },
        })
        return { freeze, subscription, accessUntil }
    }

    async end(p: {
        workspaceId: string
        userId: string
        subscriptionId: string
        freezeId: string
        now?: Date
    }): Promise<EndFreezeResult> {
        return this.prisma.$transaction(async (tx) => {
            const found = await tx.subscriptionFreeze.findFirst({
                where: {
                    id: p.freezeId,
                    workspaceId: p.workspaceId,
                    subscriptionId: p.subscriptionId,
                    userId: p.userId,
                },
                include: {
                    subscription: {
                        select: {
                            id: true,
                            status: true,
                            endDate: true,
                            workspace: { select: { timezone: true } },
                            workspaceMember: {
                                select: { id: true, accessUntil: true },
                            },
                        },
                    },
                },
            })
            if (!found) throw new NotFoundError({ message: 'Заморозка не найдена' })
            const { subscription: sub, ...freezeRow } = found
            if (sub.status !== 'ACTIVE') {
                throw new BadRequestError({
                    message: 'Абонемент отменён — заморозку изменить нельзя',
                })
            }

            const now = p.now ?? new Date()
            const res = await applyFreezeEndInTx(tx, {
                freeze: freezeRow,
                subscription: sub,
                member: sub.workspaceMember,
                todayYmd: localDateInTz(now, sub.workspace.timezone),
                now,
            })
            const subscription = await tx.subscription.findUniqueOrThrow({
                where: { id: sub.id },
                include: { plan: { select: { name: true } } },
            })
            return {
                freeze: res.freeze,
                removed: res.freeze === null,
                returnedDays: res.returnedDays,
                original: {
                    fromDate: freezeRow.fromDate,
                    untilDate: freezeRow.untilDate,
                },
                subscription,
                accessUntil: res.accessUntil,
            }
        })
    }
}
