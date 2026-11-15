import { z } from 'zod'

import { saleDiscount } from '../../../domains/discounts/discount-rules'
import { ymdToDbDate } from '../../../domains/subscriptions/freeze-dates'
import type { Prisma } from '../../../infrastructure/prisma'
import { localDateInTz, wallClockToUtc } from '../../attendance/attendance-utils'
import {
    dominantCurrency,
    paidInRangeWhere,
    refundRevenueRow,
    refundsInRangeWhere,
    revenueTrendStart,
    shiftMonth,
    summarizeAwaiting,
    ticketRevenueRow,
    ticketRevenueSelect,
    ticketsPaidInRangeWhere,
} from '../../../domains/metrics/revenue'
import { loadRenewalDue, RENEWAL_REASONS } from '../../../domains/subscriptions/renewal-rules'
import {
    AWAITING_MAX_PER_PAGE,
    ListAwaitingPaymentFeature,
    type ListAwaitingPaymentFeatureResponse,
} from '../../list-awaiting-payment/list-awaiting-payment.feature'
import { serializeRenewalCandidate } from '../../list-renewal-candidates/schemas'
import { type AutopayStatus, autopayForScope, loadAutopayStatuses } from '../../member-autopay/autopay-status'
import {
    ABONEMENT_STATE_LABELS,
    ABONEMENT_STATES,
    abonementState,
    type AbonementState,
    groupRevenue,
} from '../mcp-aggregates'
import { capResult, defineTool, McpToolError, type McpToolContext, pageInput, paginate } from '../mcp-tool'
import { assertDirectionArg, clubDate, planRef, uuidArg } from './tool-helpers'

const DAY_MS = 24 * 60 * 60 * 1000

// The member's autopay renewing an abonement (docs/design/2026-11-15-member-autopay.md
// §6): 'on' — renews by itself, don't call; 'needs_action' — stopped, the
// member must pay or confirm; null — none.
const autopayState = (a: Pick<AutopayStatus, 'status'> | null) =>
    a === null ? null : a.status === 'ACTIVE' ? ('on' as const) : ('needs_action' as const)

const RENEWAL_REASON_LABELS = {
    out_of_classes: 'Закончились занятия',
    low_classes: 'Осталось одно занятие',
    access_expiring: 'Срок абонемента / доступа заканчивается в ближайшие 7 дней или закончился недавно',
} as const

// The sale's price facts (docs/design/2026-11-15-discounts.md §1).
const salePriceSelect = {
    listPrice: true,
    discountName: true,
    discountAmount: true,
    pricedById: true,
} as const

type PricedSaleRow = {
    currency: string
    amountPaid: number | null
    listPrice: number | null
    discountName: string | null
    discountAmount: number
    pricedById: string | null
}

// `discounts_given` over some sales in the currency (saleDiscount): the total,
// the named part by discount name and the one-off rest by who set the price.
const summarizeDiscounts = async (
    ctx: McpToolContext,
    currency: string | null,
    sales: PricedSaleRow[],
) => {
    let total = 0
    let count = 0
    let oneOffAmount = 0
    const byDiscount = new Map<string, { name: string; count: number; amount: number }>()
    const byStaff = new Map<string, { count: number; amount: number }>()
    for (const s of sales) {
        if (s.currency !== currency) continue
        const d = saleDiscount(s)
        if (d.total <= 0) continue
        total += d.total
        count += 1
        if (d.named > 0 && s.discountName) {
            const b = byDiscount.get(s.discountName) ?? { name: s.discountName, count: 0, amount: 0 }
            b.count += 1
            b.amount += d.named
            byDiscount.set(s.discountName, b)
        }
        if (d.oneOff > 0) {
            oneOffAmount += d.oneOff
            if (s.pricedById) {
                const b = byStaff.get(s.pricedById) ?? { count: 0, amount: 0 }
                b.count += 1
                b.amount += d.oneOff
                byStaff.set(s.pricedById, b)
            }
        }
    }
    const staff = byStaff.size
        ? await ctx.prisma.user.findMany({
              where: { id: { in: [...byStaff.keys()] } },
              select: { id: true, firstname: true, lastname: true },
          })
        : []
    return {
        total,
        count,
        byDiscount: [...byDiscount.values()].sort((a, b) => b.amount - a.amount),
        oneOff: {
            amount: oneOffAmount,
            byStaff: [...byStaff.entries()]
                .map(([id, b]) => ({
                    // A former member's row may be gone: still one pseudonym.
                    ...ctx.people.staff(staff.find((u) => u.id === id) ?? { id, firstname: null, lastname: null }),
                    ...b,
                }))
                .sort((a, b) => b.amount - a.amount),
        },
    }
}

export const revenueReportTool = defineTool({
    name: 'revenue_report',
    title: 'Выручка',
    description:
        'Выручка клуба за вычетом возвратов за последние N месяцев (по умолчанию 6) или за один календарный месяц (month): по месяцам, по тарифам или по направлениям. ' +
        'period в ответе — за какие даты посчитано. ' +
        'Считаются оплаченные абонементы и оплаченные билеты на события (мастер-классы) по дате оплаты минус возвраты по ним по дате возврата (возврат попадает в месяц, когда сделан), в основной валюте клуба, суммы в целых рублях (единицах валюты); ' +
        'received — получено, refunded — возвращено, total — выручка (received − refunded). ' +
        'bySource — разбивка «абонементы / события». ' +
        'Абонемент на несколько направлений делится между ними поровну (и возврат по нему так же); билет относится к направлению события; продажи без направления — отдельной строкой. ' +
        'В разбивке по тарифам событие — отдельная строка (kind: event). ' +
        'discounts — скидки за тот же период: сколько не дополучено от цены по тарифу (или события) у продаж, где цена записана; в выручку уже не входят. ' +
        'byDiscount — по названной скидке, oneOff — разовые (сумму вписал сотрудник), byStaff — кто их дал. ' +
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
        const range = args.month ? { gte: start, lte: end } : { gte: start }
        const [rows, tickets, refunds] = await Promise.all([
            prisma.subscription.findMany({
                where: { workspaceId: scope.workspaceId, ...paidInRangeWhere(range) },
                select: {
                    amountPaid: true,
                    currency: true,
                    paidAt: true,
                    createdAt: true,
                    planId: true,
                    ...salePriceSelect,
                    plan: { select: { name: true } },
                    directions: { select: { direction: { select: { id: true, name: true } } } },
                },
            }),
            // The dashboard's ticket source (revenue.ts), plus the event's
            // direction for the by-direction split.
            prisma.eventRegistration.findMany({
                where: {
                    workspaceId: scope.workspaceId,
                    event: scope.events(),
                    ...ticketsPaidInRangeWhere(range),
                },
                select: {
                    ...ticketRevenueSelect,
                    ...salePriceSelect,
                    event: {
                        select: {
                            title: true,
                            currency: true,
                            direction: { select: { id: true, name: true } },
                        },
                    },
                },
            }),
            // Refunds of those sales by refund date, keyed like their sale
            // (tariff / event, its directions); a ticket's within the scope's
            // events, like the tickets. An unapplied payment's is never here.
            prisma.refund.findMany({
                where: {
                    workspaceId: scope.workspaceId,
                    ...refundsInRangeWhere(range),
                    AND: [
                        {
                            OR: [
                                { subscriptionId: { not: null } },
                                { eventRegistration: { event: scope.events() } },
                            ],
                        },
                    ],
                },
                select: {
                    amount: true,
                    currency: true,
                    refundedAt: true,
                    subscription: {
                        select: {
                            planId: true,
                            plan: { select: { name: true } },
                            directions: { select: { direction: { select: { id: true, name: true } } } },
                        },
                    },
                    eventRegistration: {
                        select: {
                            eventId: true,
                            event: {
                                select: { title: true, direction: { select: { id: true, name: true } } },
                            },
                        },
                    },
                },
            }),
        ])
        const abonementRows = rows.map((r) => ({
            amountPaid: r.amountPaid,
            currency: r.currency,
            paidAt: r.paidAt,
            createdAt: r.createdAt,
            planId: r.planId,
            planName: r.plan.name,
            directions: r.directions.map((d) => d.direction),
        }))
        const ticketRows = tickets.map((t) => ({
            ...ticketRevenueRow(t),
            paidAt: t.paidAt,
            directions: t.event.direction ? [t.event.direction] : [],
        }))
        const refundRows = refunds.map((r) => ({
            ...refundRevenueRow(r),
            ticket: r.subscription === null,
            directions: r.subscription
                ? r.subscription.directions.map((d) => d.direction)
                : r.eventRegistration?.event.direction
                  ? [r.eventRegistration.event.direction]
                  : [],
        }))
        const flat = [...abonementRows, ...ticketRows]
        // Picked by the sales; with none, the refunds' currency.
        const currency =
            dominantCurrency(flat) ??
            dominantCurrency(refundRows.map((r) => ({ amountPaid: r.amount, currency: r.currency })))
        const items = groupRevenue(
            flat,
            {
                groupBy: args.groupBy,
                currency,
                now: end,
                tz,
                months,
            },
            refundRows,
        )
        const discounts = await summarizeDiscounts(ctx, currency, [
            ...rows,
            ...tickets.map((t) => ({ ...t, currency: t.currency ?? t.event.currency })),
        ])
        // Received, refunded and net (revenue) over some sales and their
        // refunds, in the currency.
        const totals = (sales: typeof flat, refunded: typeof refundRows) => {
            const inCurrency = sales.filter((r) => r.currency === currency)
            const received = inCurrency.reduce((s, r) => s + r.amountPaid, 0)
            const back = refunded
                .filter((r) => r.currency === currency)
                .reduce((s, r) => s + r.amount, 0)
            return { revenue: received - back, received, refunded: back, sales: inCurrency.length }
        }
        const all = totals(flat, refundRows)
        // A refund-only bucket of an event sold before the period is an event too.
        const eventIds = new Set([
            ...tickets.map((t) => t.eventId),
            ...refundRows.filter((r) => r.ticket).map((r) => r.planId),
        ])
        return {
            rows: items.length,
            data: {
                period: { from: localDateInTz(start, tz), to: localDateInTz(end, tz) },
                groupBy: args.groupBy,
                currency,
                received: all.received,
                refunded: all.refunded,
                total: all.revenue,
                sales: all.sales,
                otherCurrencySales: flat.length - all.sales,
                bySource: {
                    abonements: totals(abonementRows, refundRows.filter((r) => !r.ticket)),
                    events: totals(ticketRows, refundRows.filter((r) => r.ticket)),
                },
                discounts,
                // By tariff: each item's key is the tariff id, or the event id
                // for an event's tickets.
                items:
                    args.groupBy === 'tariff'
                        ? items.map((i) =>
                              eventIds.has(i.key)
                                  ? { ...i, kind: 'event' as const }
                                  : { ...i, kind: 'tariff' as const, ref: planRef(i.key) },
                          )
                        : items,
            },
        }
    },
})

export const renewalsDueTool = defineTool({
    name: 'renewals_due',
    title: 'Кому продлевать',
    description:
        'Ученики, которым пора продлить абонемент (как список «Продлить» в админке): ' +
        'out_of_classes — занятия закончились, low_classes — осталось одно, access_expiring — срок кончается в ближайшие 7 дней или закончился не больше 30 дней назад и не продлён. ' +
        'ends — дата конца срока, daysLeft — сколько дней до неё (отрицательное — срок закончился столько дней назад). ' +
        'autopay: on — продлится автоплатежом (звонить не нужно), needs_action — автоплатёж остановлен, ждёт ученика. ' +
        'Самые срочные первыми. Только для токена администратора.',
    adminOnly: true,
    input: z.object({
        reason: z.enum(RENEWAL_REASONS).optional(),
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
        const due = await loadRenewalDue(ctx.prisma, access.workspaceId, now)
        const listed = due.filter((r) => !args.reason || r.need.reason === args.reason)
        const page = paginate(listed, args.offset, args.limit)
        const autopays = await loadAutopayStatuses(ctx.prisma, {
            workspaceId: access.workspaceId,
            userIds: page.items.map((r) => r.userId),
            now,
        })
        const items = page.items.map((r) => serializeRenewalCandidate(r, autopays.get(r.userId))).map((c) => ({
            member: people.member({
                id: c.userId,
                firstname: c.firstname,
                lastname: c.lastname,
                email: c.email,
                // Contacts only with a PERSONAL token.
                phone: people.personal ? c.phone : null,
            }),
            reason: c.reason,
            reasonLabel: RENEWAL_REASON_LABELS[c.reason],
            tariff: c.planName,
            tariffRef: c.planId ? planRef(c.planId) : null,
            ...endsIn(c.endDate ?? c.accessUntil),
            endDate: clubDate(ctx, c.endDate),
            accessUntil: clubDate(ctx, c.accessUntil),
            classesRemaining: c.classesRemaining,
            classesTotal: c.classesTotal,
            directions: c.directions.map((d) => d.name),
            autopay: autopayState(c.autopay),
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
        >(
            new ListAwaitingPaymentFeature(
                { perPage: AWAITING_MAX_PER_PAGE },
                access.workspaceId,
                access.userId,
                access.roleName,
                false,
            ),
        )
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
            tariffRef: planRef(r.planId),
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
        'autopay: on — ученик продлевает этот абонемент автоплатежом (звонить не нужно), needs_action — автоплатёж остановлен, ждёт ученика, null — автоплатежа нет. ' +
        'Суммы (amount — оплачено, refunded — возвращено, discountName — название скидки, с которой продан) — только для токена администратора.',
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
                refundedAmount: true,
                discountName: true,
                currency: true,
                plan: { select: { id: true, name: true } },
                directions: { select: { directionId: true, direction: { select: { name: true } } } },
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
        const autopays = await loadAutopayStatuses(prisma, {
            workspaceId: scope.workspaceId,
            userIds: [
                ...new Set(page.items.flatMap(({ row }) => (row.workspaceMember ? [row.workspaceMember.user.id] : []))),
            ],
            now,
        })
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
            autopay: row.workspaceMember
                ? autopayState(
                      autopayForScope(
                          autopays.get(row.workspaceMember.user.id),
                          row.directions.map((d) => d.directionId),
                      ),
                  )
                : null,
            // `amount` stays what was paid; `refunded` is what went back.
            ...(scope.seesMoney
                ? {
                      amount: row.amountPaid,
                      refunded: row.refundedAmount,
                      currency: row.currency,
                      // The named discount the sale was priced with (null: none).
                      discountName: row.discountName,
                  }
                : {}),
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
