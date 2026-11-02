import { z } from 'zod'

import { ymdToDbDate } from '../../../domains/subscriptions/freeze-dates'
import type { Prisma } from '../../../infrastructure/prisma'
import { localDateInTz, wallClockToUtc } from '../../attendance/attendance-utils'
import {
    dominantCurrency,
    paidInRangeWhere,
    revenueTrendStart,
    shiftMonth,
    summarizeAwaiting,
} from '../../get-workspace-stats/revenue'
import {
    ListAwaitingPaymentFeature,
    type ListAwaitingPaymentFeatureResponse,
} from '../../list-awaiting-payment/list-awaiting-payment.feature'
import {
    ListRenewalCandidatesFeature,
    type ListRenewalCandidatesFeatureResponse,
} from '../../list-renewal-candidates/list-renewal-candidates.feature'
import {
    ABONEMENT_STATE_LABELS,
    ABONEMENT_STATES,
    abonementState,
    type AbonementState,
    groupRevenue,
} from '../mcp-aggregates'
import { capResult, defineTool, McpToolContext, McpToolError, pageInput, paginate } from '../mcp-tool'
import { assertDirectionArg, clubDate, planRef, uuidArg } from './tool-helpers'

const DAY_MS = 24 * 60 * 60 * 1000

const RENEWAL_REASON_LABELS = {
    out_of_classes: 'Закончились занятия',
    low_classes: 'Осталось одно занятие',
    access_expiring: 'Срок абонемента / доступа заканчивается в ближайшие 7 дней или уже закончился',
} as const

// Phones for a page of members, only with a PERSONAL token (the reused admin
// lists carry names, not always contacts).
const phonesFor = async (ctx: McpToolContext, userIds: string[]) => {
    if (!ctx.people.personal || userIds.length === 0) return new Map<string, string | null>()
    const users = await ctx.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, phone: true },
    })
    return new Map(users.map((u) => [u.id, u.phone]))
}

export const revenueReportTool = defineTool({
    name: 'revenue_report',
    title: 'Выручка',
    description:
        'Выручка клуба за последние N месяцев (по умолчанию 6) или за один календарный месяц (month): по месяцам, по тарифам или по направлениям. ' +
        'period в ответе — за какие даты посчитано. ' +
        'Считаются только оплаченные абонементы по дате оплаты, в основной валюте клуба, суммы в целых рублях (единицах валюты). ' +
        'Абонемент на несколько направлений делится между ними поровну; абонементы на весь клуб — отдельной строкой. ' +
        'Только для токена администратора.',
    adminOnly: true,
    input: z.object({
        months: z.number().int().min(1).max(24).default(6).describe('Сколько календарных месяцев, включая текущий'),
        month: z
            .string()
            .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
            .optional()
            .describe('Один календарный месяц ГГГГ-ММ (например, прошлый) вместо последних N месяцев'),
        groupBy: z
            .enum(['month', 'tariff', 'direction'])
            .default('month')
            .describe('month — по месяцам, tariff — по тарифам, direction — по направлениям'),
    }),
    run: async (ctx, args) => {
        const { prisma, scope, now, access } = ctx
        const tz = access.timezone
        if (args.month && args.month > localDateInTz(now, tz).slice(0, 7)) {
            throw new McpToolError('Этот месяц ещё не наступил')
        }
        // One month ends at its last millisecond (or now, if it is the
        // current one); the last N months at now.
        const monthEnd = args.month
            ? wallClockToUtc(`${shiftMonth(args.month, 1)}-01T00:00:00`, tz).getTime() - 1
            : now.getTime()
        const end = new Date(Math.min(monthEnd, now.getTime()))
        const months = args.month ? 1 : args.months
        const start = revenueTrendStart(end, tz, months)
        const rows = await prisma.subscription.findMany({
            where: {
                workspaceId: scope.workspaceId,
                ...paidInRangeWhere(args.month ? { gte: start, lte: end } : { gte: start }),
            },
            select: {
                amountPaid: true,
                currency: true,
                paidAt: true,
                createdAt: true,
                planId: true,
                plan: { select: { name: true } },
                directions: { select: { direction: { select: { id: true, name: true } } } },
            },
        })
        const flat = rows.map((r) => ({
            amountPaid: r.amountPaid,
            currency: r.currency,
            paidAt: r.paidAt,
            createdAt: r.createdAt,
            planId: r.planId,
            planName: r.plan.name,
            directions: r.directions.map((d) => d.direction),
        }))
        const currency = dominantCurrency(flat)
        const inCurrency = flat.filter((r) => r.currency === currency)
        const items = groupRevenue(flat, {
            groupBy: args.groupBy,
            currency,
            now: end,
            tz,
            months,
        })
        return {
            rows: items.length,
            data: {
                period: { from: localDateInTz(start, tz), to: localDateInTz(end, tz) },
                groupBy: args.groupBy,
                currency,
                total: inCurrency.reduce((s, r) => s + r.amountPaid, 0),
                sales: inCurrency.length,
                otherCurrencySales: flat.length - inCurrency.length,
                // By tariff: each item's key is the tariff id.
                items:
                    args.groupBy === 'tariff'
                        ? items.map((i) => ({ ...i, ref: planRef(i.key) }))
                        : items,
            },
        }
    },
})

export const renewalsDueTool = defineTool({
    name: 'renewals_due',
    title: 'Кому продлевать',
    description:
        'Ученики, которым пора продлить абонемент (как список «На продление» в админке): ' +
        'out_of_classes — занятия закончились, low_classes — осталось одно, access_expiring — срок кончается в ближайшие 7 дней или уже закончился и не продлён. ' +
        'ends — дата конца срока, daysLeft — сколько дней до неё (отрицательное — срок закончился столько дней назад). ' +
        'Самые срочные первыми. Только для токена администратора.',
    adminOnly: true,
    input: z.object({
        reason: z.enum(['out_of_classes', 'low_classes', 'access_expiring']).optional(),
        ...pageInput,
    }),
    run: async (ctx, args) => {
        const { access, people, now } = ctx
        const today = Date.parse(localDateInTz(now, access.timezone))
        // The club-local day a term ends on and the days left until it.
        const endsIn = (end: string | null) => {
            const ends = clubDate(ctx, end)
            return { ends, daysLeft: ends === null ? null : Math.round((Date.parse(ends) - today) / DAY_MS) }
        }
        const res = await ctx.bus.execute<
            ListRenewalCandidatesFeature,
            ListRenewalCandidatesFeatureResponse
        >(
            new ListRenewalCandidatesFeature(
                access.workspaceId,
                access.userId,
                access.roleName,
                false,
            ),
        )
        const listed = res.data.filter((c) => !args.reason || c.reason === args.reason)
        const page = paginate(listed, args.offset, args.limit)
        const phones = await phonesFor(ctx, page.items.map((c) => c.userId))
        const items = page.items.map((c) => ({
            member: people.member({
                id: c.userId,
                firstname: c.firstname,
                lastname: c.lastname,
                email: c.email,
                phone: phones.get(c.userId) ?? null,
            }),
            reason: c.reason,
            reasonLabel: RENEWAL_REASON_LABELS[c.reason],
            tariff: c.planName,
            ...endsIn(c.endDate ?? c.accessUntil),
            endDate: clubDate(ctx, c.endDate),
            accessUntil: clubDate(ctx, c.accessUntil),
            classesRemaining: c.classesRemaining,
            classesTotal: c.classesTotal,
            directions: c.directions.map((d) => d.name),
        }))
        return {
            rows: items.length,
            data: capResult({ total: page.total, nextOffset: page.nextOffset, items }),
        }
    },
})

export const unpaidAbonementsTool = defineTool({
    name: 'unpaid_abonements',
    title: 'Долги: неоплаченные абонементы',
    description:
        'Абонементы, проданные, но ещё не оплаченные («Ожидают оплаты»): кто, какой тариф, сумма, когда продан. ' +
        'Итог — количество и сумма долга в основной валюте (целые единицы). Старые долги первыми. Только для токена администратора.',
    adminOnly: true,
    input: z.object({ ...pageInput }),
    run: async (ctx, args) => {
        const { access, people, now } = ctx
        const res = await ctx.bus.execute<
            ListAwaitingPaymentFeature,
            ListAwaitingPaymentFeatureResponse
        >(new ListAwaitingPaymentFeature(access.workspaceId, access.userId, access.roleName, false))
        const totals = summarizeAwaiting(
            res.data.map((r) => ({ amountPaid: r.amount, currency: r.currency })),
            null,
        )
        const page = paginate(res.data, args.offset, args.limit)
        const items = page.items.map((r) => ({
            member: people.personal
                ? { ref: people.memberRef(r.userId), name: r.memberName, phone: r.memberPhone }
                : { ref: people.memberRef(r.userId) },
            tariff: r.planName,
            amount: r.amount,
            currency: r.currency,
            startDate: clubDate(ctx, r.startDate),
            soldAt: r.createdAt,
            daysSinceSale: Math.floor((now.getTime() - Date.parse(r.createdAt)) / DAY_MS),
        }))
        return {
            rows: items.length,
            data: capResult({
                summary: {
                    count: res.total,
                    amount: totals.amount,
                    currency: dominantCurrency(
                        res.data.map((r) => ({ amountPaid: r.amount, currency: r.currency })),
                    ),
                    // The admin list is capped; past it the amount covers the
                    // listed rows only.
                    listed: res.data.length,
                },
                total: page.total,
                nextOffset: page.nextOffset,
                items,
            }),
        }
    },
})

export const abonementStatesTool = defineTool({
    name: 'abonement_states',
    title: 'Состояние абонементов',
    description:
        'Абонементы учеников по состояниям: frozen — заморожен, awaiting_first_visit — ждёт первой тренировки, ' +
        'out_of_classes — занятия закончились, expiring_soon — кончается в 7 дней, active — действует, ended — закончился за последние 30 дней. ' +
        'В ответе сводка по состояниям и тарифам и постраничный список (фильтр state). ' +
        'Суммы — только для токена администратора.',
    input: z.object({
        state: z.enum(ABONEMENT_STATES).optional().describe('Только абонементы в этом состоянии'),
        planId: uuidArg('Только этот тариф (id из club_directory)').optional(),
        directionId: uuidArg('Только абонементы, действующие на это направление').optional(),
        unpaidOnly: z.boolean().default(false).describe('Только неоплаченные'),
        ...pageInput,
    }),
    run: async (ctx, args) => {
        const { prisma, scope, people, now, access } = ctx
        await assertDirectionArg(ctx, args.directionId)
        const todayYmd = localDateInTz(now, access.timezone)
        const filters: Prisma.SubscriptionWhereInput[] = [
            { workspaceId: scope.workspaceId, workspaceMember: scope.students() },
            { status: { in: ['ACTIVE', 'EXPIRED'] } },
            {
                OR: [
                    { endDate: null },
                    { endDate: { gt: new Date(now.getTime() - 30 * DAY_MS) } },
                ],
            },
        ]
        if (!scope.isAdmin) {
            filters.push({
                OR: [
                    { directions: { none: {} } },
                    { directions: { some: { directionId: { in: scope.directionIds ?? [] } } } },
                ],
            })
        }
        if (args.planId) filters.push({ planId: args.planId })
        if (args.directionId) filters.push({ directions: { some: { directionId: args.directionId } } })
        if (args.unpaidOnly) filters.push({ isPaid: false })

        const rows = await prisma.subscription.findMany({
            where: { AND: filters },
            orderBy: [{ endDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
            take: 5000,
            select: {
                status: true,
                startDate: true,
                endDate: true,
                classesRemaining: true,
                classesTotal: true,
                isPaid: true,
                amountPaid: true,
                currency: true,
                plan: { select: { id: true, name: true } },
                directions: { select: { direction: { select: { name: true } } } },
                freezes: {
                    where: { untilDate: { gte: ymdToDbDate(todayYmd) } },
                    select: { fromDate: true, untilDate: true },
                },
                workspaceMember: {
                    select: {
                        user: {
                            select: { id: true, firstname: true, lastname: true, email: true, phone: true },
                        },
                    },
                },
            },
        })
        const soon = new Date(now.getTime() + 7 * DAY_MS)
        const withState = rows.map((r) => ({ row: r, state: abonementState(r, { now, todayYmd, soon }) }))

        const byState = Object.fromEntries(ABONEMENT_STATES.map((s) => [s, 0])) as Record<AbonementState, number>
        const byTariff = new Map<
            string,
            { tariff: string; ref: string; total: number; byState: Partial<Record<AbonementState, number>> }
        >()
        for (const { row, state } of withState) {
            byState[state] += 1
            const t = byTariff.get(row.plan.id) ?? {
                tariff: row.plan.name,
                ref: planRef(row.plan.id),
                total: 0,
                byState: {},
            }
            t.total += 1
            t.byState[state] = (t.byState[state] ?? 0) + 1
            byTariff.set(row.plan.id, t)
        }

        const listed = withState.filter((x) => !args.state || x.state === args.state)
        const page = paginate(listed, args.offset, args.limit)
        const items = page.items.map(({ row, state }) => ({
            member: row.workspaceMember ? people.member(row.workspaceMember.user) : null,
            tariff: row.plan.name,
            tariffRef: planRef(row.plan.id),
            state,
            stateLabel: ABONEMENT_STATE_LABELS[state],
            startDate: clubDate(ctx, row.startDate),
            endDate: clubDate(ctx, row.endDate),
            classesRemaining: row.classesRemaining,
            classesTotal: row.classesTotal,
            directions: row.directions.map((d) => d.direction.name),
            isPaid: row.isPaid,
            ...(scope.isAdmin ? { amount: row.amountPaid, currency: row.currency } : {}),
        }))
        return {
            rows: items.length,
            data: capResult({
                summary: {
                    byState: ABONEMENT_STATES.map((s) => ({ state: s, label: ABONEMENT_STATE_LABELS[s], count: byState[s] })),
                    byTariff: [...byTariff.values()].sort((a, b) => b.total - a.total),
                },
                total: page.total,
                nextOffset: page.nextOffset,
                items,
            }),
        }
    },
})
