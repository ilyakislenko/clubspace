// «Платежи» — the payments journal (docs/design/2026-11-15-payments-journal.md
// §1, §3.1). Its rows are the sales revenue already counts (glossary B2
// `payments_received`): paid abonements and paid event tickets, dated by
// payment — and the refunds of those sales (`refunds`), dated by refund. No
// ledger table: each source is read where it lives, merged and sliced, so the
// journal's «Итого» over a period is that period's revenue by construction.
// An online Payment is the provider's side of a sale and hangs off its row
// (`online`); a paid-but-unapplied one (activationError) is not a sale and
// only shows in the «needs decision» strip (its refund is not a journal row).

import { displayName } from '../../features/attendance/schemas'
import { localDateInTz } from '../../features/attendance/attendance-utils'
import type { Prisma, PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { localDayRange } from '../../shared/utils/local-day-range'
import type { PaymentMethodValue } from '../../shared/utils/payment-method'
import type { AnalyticsScope } from '../analytics/analytics-reports'
import { analyticsScopeMemberWhere } from '../analytics/analytics-scope'
import { saleDiscount } from '../discounts/discount-rules'
import { DAY_MS } from '../subscriptions/freeze-dates'
import { userSearchWhere } from '../users/user-search'
import {
    refundsInRangeWhere,
    revenueWindowStart,
    ticketsPaidInRangeWhere,
} from '../metrics/revenue'

// A sale's method as the journal filters and totals it: the stored
// PaymentMethod, or NONE where nothing was recorded («Не указан»).
export const JOURNAL_METHODS = ['CASH', 'TRANSFER', 'CARD', 'ONLINE', 'NONE'] as const
export type JournalMethod = (typeof JOURNAL_METHODS)[number]
// Payments, refunds or both.
export const JOURNAL_KINDS = ['all', 'payment', 'refund'] as const
export type JournalKind = (typeof JOURNAL_KINDS)[number]

// Merge-and-slice reads curPage × perPage rows from every source; past this
// depth the journal asks for a narrower view (or the CSV) instead.
export const JOURNAL_MAX_DEPTH = 5000
export const JOURNAL_TOO_DEEP_MESSAGE = 'Слишком далеко — сузьте период или фильтры'
// The longest period one view may span, in club-local days.
export const JOURNAL_MAX_PERIOD_DAYS = 366
// The «needs decision» strip shows this many unapplied payments, oldest first.
export const UNAPPLIED_LIMIT = 20

export type JournalRange = { gte: Date; lte?: Date }

export type JournalFilter = {
    workspaceId: string
    range: JournalRange
    method?: JournalMethod
    kind?: JournalKind
    // Payments: who marked them paid (Subscription / EventRegistration
    // markedPaidById); refunds: who refunded (Refund.createdById).
    markedById?: string
    // The analytics scope (members of the matching groups); groupIds null =
    // the whole club, no narrowing.
    scope?: AnalyticsScope
    // Search on the holder (domains/users/user-search).
    q?: string
    // «Со скидкой»: sales with a total discount > 0 (named or one-off,
    // docs/design/2026-11-15-discounts.md §1); one discount; whose price that
    // staff member set (pricedById). Refunds carry none, so any of the three
    // leaves them out.
    discounted?: boolean
    discountId?: string
    pricedById?: string
}

// The period a view covers. No dates = the `revenue_30d` window (from
// revenueWindowStart(now), open-ended like loadSales), so the default «Итого»
// equals the dashboard's «Выручка за 30 дней». Dates are inclusive club-local
// days: both or neither, `to` not before `from`, at most a year.
export const resolveJournalPeriod = (
    input: { from?: string; to?: string },
    tz: string,
    now: Date,
): { range: JournalRange; from: string; to: string } => {
    if (!input.from && !input.to) {
        const gte = revenueWindowStart(now)
        return { range: { gte }, from: localDateInTz(gte, tz), to: localDateInTz(now, tz) }
    }
    if (!input.from || !input.to) {
        throw new BadRequestError({ message: 'Укажите обе даты периода' })
    }
    if (input.to < input.from) {
        throw new BadRequestError({ message: 'Конец периода раньше начала' })
    }
    const days =
        (Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`)) / DAY_MS + 1
    if (days > JOURNAL_MAX_PERIOD_DAYS) {
        throw new BadRequestError({
            message: `Период длиннее ${JOURNAL_MAX_PERIOD_DAYS} дней — выберите короче`,
        })
    }
    const range = localDayRange(input, tz) as { gte: Date; lte: Date }
    return { range, from: input.from, to: input.to }
}

// ---- Where-builders: the same filters on every source ----

const methodWhere = (method: JournalMethod | undefined) =>
    method === undefined ? {} : { paymentMethod: method === 'NONE' ? null : method }

const scoped = (f: JournalFilter): f is JournalFilter & { scope: AnalyticsScope } =>
    !!f.scope && f.scope.groupIds !== null

// The sale's discount filters (JournalFilter.discounted / discountId /
// pricedById). «Со скидкой» = amountPaid below the recorded list price,
// compared in the database through the client's field reference.
const discountWhere = <Model>(f: JournalFilter, listPrice: Prisma.FieldRef<Model, 'Int'>) => ({
    ...(f.discounted ? { listPrice: { not: null }, amountPaid: { lt: listPrice } } : {}),
    ...(f.discountId ? { discountId: f.discountId } : {}),
    ...(f.pricedById ? { pricedById: f.pricedById } : {}),
})

// Paid abonements in the period. Under a scope only current members of the
// matching groups (a former member's row has no membership and drops out).
// `fields`: the client's Subscription field references (prisma.subscription.fields).
export const journalSubscriptionWhere = (
    f: JournalFilter,
    fields: { listPrice: Prisma.FieldRef<'Subscription', 'Int'> },
): Prisma.SubscriptionWhereInput => ({
    workspaceId: f.workspaceId,
    isPaid: true,
    paidAt: f.range,
    ...methodWhere(f.method),
    ...(f.markedById ? { markedPaidById: f.markedById } : {}),
    ...(scoped(f) ? { workspaceMember: analyticsScopeMemberWhere(f.scope) } : {}),
    ...(f.q ? { user: { AND: userSearchWhere(f.q) } } : {}),
    ...discountWhere(f, fields.listPrice),
})

// Paid event tickets in the period (revenue.ts ticketsPaidInRangeWhere);
// cancelled ones too — a paid row stays the money's record.
export const journalTicketWhere = (
    f: JournalFilter,
    fields: { listPrice: Prisma.FieldRef<'EventRegistration', 'Int'> },
): Prisma.EventRegistrationWhereInput => {
    const user: Prisma.UserWhereInput[] = [
        ...(scoped(f)
            ? [
                  {
                      workspaceMemberships: {
                          some: { workspaceId: f.workspaceId, ...analyticsScopeMemberWhere(f.scope) },
                      },
                  },
              ]
            : []),
        ...(f.q ? userSearchWhere(f.q) : []),
    ]
    return {
        workspaceId: f.workspaceId,
        ...ticketsPaidInRangeWhere(f.range),
        ...methodWhere(f.method),
        ...(f.markedById ? { markedPaidById: f.markedById } : {}),
        ...(user.length > 0 ? { user: { AND: user } } : {}),
        ...discountWhere(f, fields.listPrice),
    }
}

// Refunds of sales (never of an unapplied payment) in the period, by refund
// date. `method` is the refund's own; the scope and the search go on the
// holder, like tickets.
export const journalRefundWhere = (f: JournalFilter): Prisma.RefundWhereInput => {
    const user: Prisma.UserWhereInput[] = [
        ...(scoped(f)
            ? [
                  {
                      workspaceMemberships: {
                          some: { workspaceId: f.workspaceId, ...analyticsScopeMemberWhere(f.scope) },
                      },
                  },
              ]
            : []),
        ...(f.q ? userSearchWhere(f.q) : []),
    ]
    return {
        workspaceId: f.workspaceId,
        // The same refunds revenue subtracts (revenue.ts refundsInRangeWhere).
        ...refundsInRangeWhere(f.range),
        ...(f.method && f.method !== 'NONE' ? { method: f.method } : {}),
        ...(f.markedById ? { createdById: f.markedById } : {}),
        ...(user.length > 0 ? { user: { AND: user } } : {}),
    }
}

// Sales are rows of every kind but «only refunds».
const includesSales = (f: JournalFilter) => f.kind !== 'refund'
// Refunds are rows of every kind but «only payments»; a refund always has a
// method, so «Не указан» has none, and no discount of its own.
const includesRefunds = (f: JournalFilter) =>
    f.kind !== 'payment' && f.method !== 'NONE' && !f.discounted && !f.discountId && !f.pricedById

// ---- Rows ----

const personSelect = { select: { firstname: true, lastname: true, email: true } } as const
const onlineSelect = {
    id: true,
    provider: true,
    providerPaymentId: true,
    status: true,
    amount: true,
    refundedAmount: true,
    // The agreement it set up (with the consent version) or charged
    // (without): docs/design/2026-11-15-member-autopay.md §2.2.
    autopayId: true,
    autopayConsentVersion: true,
} as const
// The sale's price facts (docs/design/2026-11-15-discounts.md §1).
const salePriceSelect = {
    listPrice: true,
    discountId: true,
    discountName: true,
    discountAmount: true,
    pricedById: true,
} as const

export const journalSubscriptionSelect = {
    id: true,
    paidAt: true,
    createdAt: true,
    amountPaid: true,
    refundedAmount: true,
    currency: true,
    paymentMethod: true,
    markedPaidById: true,
    classesTotal: true,
    userId: true,
    plan: { select: { name: true } },
    user: personSelect,
    // Rows sold before Subscription.userId existed.
    workspaceMember: { select: { userId: true, user: personSelect } },
    payment: { select: onlineSelect },
    ...salePriceSelect,
} satisfies Prisma.SubscriptionSelect

export const journalTicketSelect = {
    id: true,
    paidAt: true,
    createdAt: true,
    amountPaid: true,
    refundedAmount: true,
    currency: true,
    paymentMethod: true,
    markedPaidById: true,
    userId: true,
    eventId: true,
    event: { select: { title: true, currency: true } },
    user: personSelect,
    // The payment that marked it paid online (one at most; any other that
    // succeeded carries an activationError). REFUNDED: refunded in full.
    payments: {
        where: { status: { in: ['SUCCEEDED' as const, 'REFUNDED' as const] }, activationError: null },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: onlineSelect,
    },
    ...salePriceSelect,
} satisfies Prisma.EventRegistrationSelect

// The refunded sale as the refund row names it (`refundOf`).
const refundedSaleSelect = { id: true, paidAt: true, createdAt: true, amountPaid: true } as const

export const journalRefundSelect = {
    id: true,
    refundedAt: true,
    amount: true,
    currency: true,
    method: true,
    reason: true,
    createdById: true,
    userId: true,
    itemName: true,
    user: personSelect,
    subscription: { select: refundedSaleSelect },
    eventRegistration: { select: { ...refundedSaleSelect, eventId: true } },
    payment: { select: onlineSelect },
} satisfies Prisma.RefundSelect

type Person = { firstname: string | null; lastname: string | null; email: string | null }
export type JournalOnline = {
    id: string
    provider: 'YOOKASSA' | 'STRIPE'
    providerPaymentId: string | null
    status: 'PENDING' | 'SUCCEEDED' | 'CANCELED' | 'REFUNDED'
    amount: number
    refundedAmount: number
    autopayId: string | null
    autopayConsentVersion: string | null
}

// A renewal charged by the member's autopay agreement («Онлайн · автоплатёж»).
// The setup checkout is linked to the agreement too, but it is the member's
// own purchase: it carries the consent version they ticked.
export const isAutopayCharge = (
    p: Pick<JournalOnline, 'autopayId' | 'autopayConsentVersion'> | null | undefined,
): boolean => !!p?.autopayId && p.autopayConsentVersion === null

// One journal row, source-independent. `id` is the public key
// (`sub:<uuid>` / `reg:<uuid>` / `ref:<uuid>`), `rawId` the source row's id.
export type JournalRow = {
    id: string
    rawId: string
    kind: 'payment' | 'refund'
    // A refund row: the refunded sale's source.
    source: 'abonement' | 'ticket'
    at: Date
    // Positive on both kinds; a refund is drawn (and exported) as «−».
    amount: number
    currency: string
    method: PaymentMethodValue | null
    userId: string | null
    person: Person | null
    itemName: string
    subscriptionId: string | null
    eventRegistrationId: string | null
    eventId: string | null
    // Payment: who marked it paid; refund: who refunded.
    markedById: string | null
    classesTotal: number | null
    online: JournalOnline | null
    // Payment rows: Σ of the sale's refunds (0 on refund rows).
    refundedAmount: number
    // Refund rows only.
    reason: string | null
    refundOf: { id: string; at: Date; amount: number } | null
    // Payment rows: the price facts. null / 0 on refund rows and on sales
    // recorded before discounts (no list price: no discount shown).
    listPrice: number | null
    discountId: string | null
    discountName: string | null
    // saleDiscount: total = max(0, listPrice − amount), its named part and
    // the one-off rest; derived, never stored.
    discount: { total: number; named: number; oneOff: number }
    // Who set the amount (the seller, or who changed it at mark-paid).
    pricedById: string | null
}

type SalePriceRecord = {
    listPrice: number | null
    discountId: string | null
    discountName: string | null
    discountAmount: number
    pricedById: string | null
}

const salePriceFacts = (s: SalePriceRecord & { amountPaid: number | null }) => ({
    listPrice: s.listPrice,
    discountId: s.discountId,
    discountName: s.discountName,
    discount: saleDiscount(s),
    pricedById: s.pricedById,
})

const NO_SALE_PRICE = {
    listPrice: null,
    discountId: null,
    discountName: null,
    discount: { total: 0, named: 0, oneOff: 0 },
    pricedById: null,
}

type SubscriptionJournalRecord = SalePriceRecord & {
    id: string
    paidAt: Date | null
    createdAt: Date
    amountPaid: number
    refundedAmount: number
    currency: string
    paymentMethod: PaymentMethodValue | null
    markedPaidById: string | null
    classesTotal: number | null
    userId: string | null
    plan: { name: string }
    user: Person | null
    workspaceMember: { userId: string; user: Person } | null
    payment: JournalOnline | null
}

type TicketJournalRecord = SalePriceRecord & {
    id: string
    paidAt: Date | null
    createdAt: Date
    amountPaid: number | null
    refundedAmount: number
    currency: string | null
    paymentMethod: PaymentMethodValue | null
    markedPaidById: string | null
    userId: string
    eventId: string
    event: { title: string; currency: string }
    user: Person
    payments: JournalOnline[]
}

type RefundedSale = { id: string; paidAt: Date | null; createdAt: Date; amountPaid: number | null }

type RefundJournalRecord = {
    id: string
    refundedAt: Date
    amount: number
    currency: string
    method: PaymentMethodValue
    reason: string
    createdById: string
    userId: string
    itemName: string
    user: Person
    subscription: RefundedSale | null
    eventRegistration: (RefundedSale & { eventId: string }) | null
    payment: JournalOnline | null
}

export const subscriptionJournalRow = (s: SubscriptionJournalRecord): JournalRow => ({
    id: `sub:${s.id}`,
    rawId: s.id,
    kind: 'payment',
    source: 'abonement',
    // paidAt is set on every paid row (backfill-payment-journal.sql filled the
    // legacy ones); the fallback is revenue.ts paidOn.
    at: s.paidAt ?? s.createdAt,
    amount: s.amountPaid,
    currency: s.currency,
    method: s.paymentMethod,
    userId: s.userId ?? s.workspaceMember?.userId ?? null,
    person: s.user ?? s.workspaceMember?.user ?? null,
    itemName: s.plan.name,
    subscriptionId: s.id,
    eventRegistrationId: null,
    eventId: null,
    markedById: s.markedPaidById,
    classesTotal: s.classesTotal,
    online: s.payment,
    refundedAmount: s.refundedAmount,
    reason: null,
    refundOf: null,
    ...salePriceFacts(s),
})

export const ticketJournalRow = (t: TicketJournalRecord): JournalRow => ({
    id: `reg:${t.id}`,
    rawId: t.id,
    kind: 'payment',
    source: 'ticket',
    at: t.paidAt ?? t.createdAt,
    amount: t.amountPaid ?? 0,
    currency: t.currency ?? t.event.currency,
    method: t.paymentMethod,
    userId: t.userId,
    person: t.user,
    itemName: t.event.title,
    subscriptionId: null,
    eventRegistrationId: t.id,
    eventId: t.eventId,
    markedById: t.markedPaidById,
    classesTotal: null,
    // Paid at the club after an online attempt: the method decides.
    online: t.paymentMethod === 'ONLINE' ? (t.payments[0] ?? null) : null,
    refundedAmount: t.refundedAmount,
    reason: null,
    refundOf: null,
    ...salePriceFacts(t),
})

export const refundJournalRow = (r: RefundJournalRecord): JournalRow => {
    const sale = r.subscription ?? r.eventRegistration
    return {
        id: `ref:${r.id}`,
        rawId: r.id,
        kind: 'refund',
        source: r.subscription ? 'abonement' : 'ticket',
        at: r.refundedAt,
        amount: r.amount,
        currency: r.currency,
        method: r.method,
        userId: r.userId,
        person: r.user,
        itemName: r.itemName,
        subscriptionId: r.subscription?.id ?? null,
        eventRegistrationId: r.eventRegistration?.id ?? null,
        eventId: r.eventRegistration?.eventId ?? null,
        markedById: r.createdById,
        classesTotal: null,
        online: r.payment,
        refundedAmount: 0,
        reason: r.reason,
        refundOf: sale
            ? {
                  id: r.subscription ? `sub:${sale.id}` : `reg:${sale.id}`,
                  at: sale.paidAt ?? sale.createdAt,
                  amount: sale.amountPaid ?? 0,
              }
            : null,
        ...NO_SALE_PRICE,
    }
}

// Newest first; within one instant by id, descending — the order every
// source is read in, so a merge of the sources' first N rows is the first N.
export const compareJournalRows = (a: JournalRow, b: JournalRow): number =>
    b.at.getTime() - a.at.getTime() || (a.rawId < b.rawId ? 1 : a.rawId > b.rawId ? -1 : 0)

export const mergeJournalRows = (sources: JournalRow[][]): JournalRow[] =>
    sources.flat().sort(compareJournalRows)

const journalOrderBy = [{ paidAt: 'desc' as const }, { id: 'desc' as const }]
const refundOrderBy = [{ refundedAt: 'desc' as const }, { id: 'desc' as const }]

// The three sources' where of one view.
const journalWheres = (prisma: PrismaService, f: JournalFilter) => ({
    sub: journalSubscriptionWhere(f, prisma.subscription.fields),
    ticket: journalTicketWhere(f, prisma.eventRegistration.fields),
    refund: journalRefundWhere(f),
})

const readSources = async (
    prisma: PrismaService,
    f: JournalFilter,
    take: number | undefined,
): Promise<JournalRow[][]> => {
    const limit: { take?: number } = take === undefined ? {} : { take }
    const where = journalWheres(prisma, f)
    const [subs, tickets, refunds] = await Promise.all([
        includesSales(f)
            ? prisma.subscription.findMany({
                  where: where.sub,
                  orderBy: journalOrderBy,
                  ...limit,
                  select: journalSubscriptionSelect,
              })
            : [],
        includesSales(f)
            ? prisma.eventRegistration.findMany({
                  where: where.ticket,
                  orderBy: journalOrderBy,
                  ...limit,
                  select: journalTicketSelect,
              })
            : [],
        includesRefunds(f)
            ? prisma.refund.findMany({
                  where: where.refund,
                  orderBy: refundOrderBy,
                  ...limit,
                  select: journalRefundSelect,
              })
            : [],
    ])
    return [
        subs.map(subscriptionJournalRow),
        tickets.map(ticketJournalRow),
        refunds.map(refundJournalRow),
    ]
}

// One page: each source's first curPage × perPage rows, merged, sliced.
// `total` = the sources' counts.
export const loadJournalPage = async (
    prisma: PrismaService,
    f: JournalFilter,
    page: { curPage: number; perPage: number },
): Promise<{ rows: JournalRow[]; total: number }> => {
    const depth = page.curPage * page.perPage
    if (depth > JOURNAL_MAX_DEPTH) {
        throw new BadRequestError({ message: JOURNAL_TOO_DEEP_MESSAGE })
    }
    const where = journalWheres(prisma, f)
    const [sources, subCount, ticketCount, refundCount] = await Promise.all([
        readSources(prisma, f, depth),
        includesSales(f) ? prisma.subscription.count({ where: where.sub }) : 0,
        includesSales(f) ? prisma.eventRegistration.count({ where: where.ticket }) : 0,
        includesRefunds(f) ? prisma.refund.count({ where: where.refund }) : 0,
    ])
    return {
        rows: mergeJournalRows(sources).slice((page.curPage - 1) * page.perPage, depth),
        total: subCount + ticketCount + refundCount,
    }
}

// Every row of the view, in journal order (the CSV).
export const loadJournalRows = async (
    prisma: PrismaService,
    f: JournalFilter,
): Promise<JournalRow[]> => mergeJournalRows(await readSources(prisma, f, undefined))

// ---- People on the rows ----

export type JournalPeople = {
    // Names of the staff who marked the rows.
    names: Map<string, string>
    // Holders who are members of the club now (their card opens).
    members: Set<string>
}

// `otherHolderIds`: people shown beside the rows (the unapplied strip's
// buyers) whose membership is asked in the same query.
export const loadJournalPeople = async (
    prisma: PrismaService,
    workspaceId: string,
    rows: JournalRow[],
    otherHolderIds: string[] = [],
): Promise<JournalPeople> => {
    // The staff named on the rows: who marked / refunded, and who set a
    // discounted sale's price.
    const markerIds = [
        ...new Set(
            rows.flatMap((r) =>
                [r.markedById, r.discount.total > 0 ? r.pricedById : null].filter((id): id is string => !!id),
            ),
        ),
    ]
    const holderIds = [
        ...new Set([...rows.flatMap((r) => (r.userId ? [r.userId] : [])), ...otherHolderIds]),
    ]
    const [markers, members] = await Promise.all([
        markerIds.length > 0
            ? prisma.user.findMany({
                  where: { id: { in: markerIds } },
                  select: { id: true, firstname: true, lastname: true, email: true },
              })
            : [],
        holderIds.length > 0
            ? prisma.workspaceMember.findMany({
                  where: { workspaceId, userId: { in: holderIds } },
                  select: { userId: true },
              })
            : [],
    ])
    return {
        names: new Map(markers.map((u): [string, string] => [u.id, displayName(u)])),
        members: new Set(members.map((m) => m.userId)),
    }
}

// ---- Totals ----

export type JournalTotalBucket = {
    kind: 'payment' | 'refund'
    method: PaymentMethodValue | null
    currency: string
    amount: number
    count: number
}

export type JournalMethodTotal = {
    method: JournalMethod
    received: number
    refunded: number
    count: number
}

export type JournalCurrencyTotal = {
    currency: string
    received: number
    refunded: number
    net: number
    byMethod: JournalMethodTotal[]
    // `discounts_given` over the view's payment rows: how many carry a
    // discount, Σ total discount and its one-off part. Never part of net.
    discounted: { count: number; amount: number; oneOffAmount: number }
}

// One discounted sale of the view (saleDiscount), in its currency.
export type JournalDiscountBucket = { currency: string; total: number; oneOff: number }

// Per currency, the dominant one first (most payment rows; ties by first
// seen, as revenue.ts dominantCurrency), then by method in a fixed order;
// methods with nothing are left out. A refund counts as refunded under its
// own method, never as received. Discounts are summed per currency beside it.
export const summarizeJournalTotals = (
    buckets: JournalTotalBucket[],
    discounts: JournalDiscountBucket[] = [],
): JournalCurrencyTotal[] => {
    const byCurrency = new Map<string, { count: number; methods: Map<JournalMethod, JournalMethodTotal> }>()
    for (const b of buckets) {
        if (b.count === 0) continue
        const cur = byCurrency.get(b.currency) ?? { count: 0, methods: new Map() }
        byCurrency.set(b.currency, cur)
        const method: JournalMethod = b.method ?? 'NONE'
        const m = cur.methods.get(method) ?? { method, received: 0, refunded: 0, count: 0 }
        cur.methods.set(method, m)
        if (b.kind === 'refund') {
            m.refunded += b.amount
            continue
        }
        cur.count += b.count
        m.received += b.amount
        m.count += b.count
    }
    return [...byCurrency.entries()]
        .map(([currency, c], seen) => ({ currency, c, seen }))
        .sort((a, b) => b.c.count - a.c.count || a.seen - b.seen)
        .map(({ currency, c }) => {
            const byMethod = JOURNAL_METHODS.flatMap((m) => {
                const t = c.methods.get(m)
                return t ? [t] : []
            })
            const received = byMethod.reduce((sum, m) => sum + m.received, 0)
            const refunded = byMethod.reduce((sum, m) => sum + m.refunded, 0)
            const discounted = { count: 0, amount: 0, oneOffAmount: 0 }
            for (const d of discounts) {
                if (d.currency !== currency || d.total <= 0) continue
                discounted.count += 1
                discounted.amount += d.total
                discounted.oneOffAmount += d.oneOff
            }
            return { currency, received, refunded, net: received - refunded, byMethod, discounted }
        })
}

// Totals over the whole view (not the page): one groupBy per source.
export const loadJournalTotals = async (
    prisma: PrismaService,
    f: JournalFilter,
): Promise<JournalCurrencyTotal[]> => {
    const where = journalWheres(prisma, f)
    const ticketWhere = where.ticket
    // The discounted sales of the view, row by row: the split into named and
    // one-off isn't a sum of columns (saleDiscount caps the named part).
    const discountedWhere = journalWheres(prisma, { ...f, discounted: true })
    const [subs, tickets, refunds, discountedSubs, discountedTickets] = await Promise.all([
        includesSales(f)
            ? prisma.subscription.groupBy({
                  by: ['paymentMethod', 'currency'],
                  where: where.sub,
                  _sum: { amountPaid: true },
                  _count: { _all: true },
              })
            : [],
        includesSales(f)
            ? prisma.eventRegistration.groupBy({
                  by: ['paymentMethod', 'currency'],
                  where: ticketWhere,
                  _sum: { amountPaid: true },
                  _count: { _all: true },
              })
            : [],
        includesRefunds(f)
            ? prisma.refund.groupBy({
                  by: ['method', 'currency'],
                  where: where.refund,
                  _sum: { amount: true },
                  _count: { _all: true },
              })
            : [],
        includesSales(f)
            ? prisma.subscription.findMany({
                  where: discountedWhere.sub,
                  select: { listPrice: true, amountPaid: true, discountAmount: true, currency: true },
              })
            : [],
        includesSales(f)
            ? prisma.eventRegistration.findMany({
                  where: discountedWhere.ticket,
                  select: {
                      listPrice: true,
                      amountPaid: true,
                      discountAmount: true,
                      currency: true,
                      event: { select: { currency: true } },
                  },
              })
            : [],
    ])
    const buckets = subs.map((g): JournalTotalBucket => ({
        kind: 'payment',
        method: g.paymentMethod,
        currency: g.currency,
        amount: g._sum.amountPaid ?? 0,
        count: g._count._all,
    }))
    for (const g of refunds) {
        buckets.push({
            kind: 'refund',
            method: g.method,
            currency: g.currency,
            amount: g._sum.amount ?? 0,
            count: g._count._all,
        })
    }
    for (const g of tickets) {
        if (g.currency !== null) {
            buckets.push({
                kind: 'payment',
                method: g.paymentMethod,
                currency: g.currency,
                amount: g._sum.amountPaid ?? 0,
                count: g._count._all,
            })
            continue
        }
        // A ticket without its own currency is in the event's
        // (revenue.ts ticketRevenueRow): resolve those few rows one by one.
        const rows = await prisma.eventRegistration.findMany({
            where: { AND: [ticketWhere, { currency: null, paymentMethod: g.paymentMethod }] },
            select: { amountPaid: true, event: { select: { currency: true } } },
        })
        for (const r of rows) {
            buckets.push({
                kind: 'payment',
                method: g.paymentMethod,
                currency: r.event.currency,
                amount: r.amountPaid ?? 0,
                count: 1,
            })
        }
    }
    const discounts = [
        ...discountedSubs.map((r) => ({ currency: r.currency, ...saleDiscount(r) })),
        ...discountedTickets.map((r) => ({ currency: r.currency ?? r.event.currency, ...saleDiscount(r) })),
    ]
    return summarizeJournalTotals(buckets, discounts)
}

// ---- Unapplied online payments (the «needs decision» strip) ----

// Paid through the checkout, but no abonement / place could be granted. Not a
// sale: never a row, never revenue; listed until refunded in full (a partial
// refund keeps it, with less left to refund).
export const unappliedPaymentWhere = (workspaceId: string): Prisma.PaymentWhereInput => ({
    workspaceId,
    status: 'SUCCEEDED',
    activationError: { not: null },
})

export type UnappliedPaymentRow = {
    id: string
    paidAt: Date | null
    createdAt: Date
    userId: string
    user: Person
    planName: string
    amount: number
    refundedAmount: number
    currency: string
    provider: 'YOOKASSA' | 'STRIPE'
    activationError: string | null
}

export const loadUnappliedPayments = async (
    prisma: PrismaService,
    workspaceId: string,
): Promise<{ total: number; rows: UnappliedPaymentRow[] }> => {
    const where = unappliedPaymentWhere(workspaceId)
    const [total, rows] = await Promise.all([
        prisma.payment.count({ where }),
        prisma.payment.findMany({
            where,
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: UNAPPLIED_LIMIT,
            select: {
                id: true,
                paidAt: true,
                createdAt: true,
                userId: true,
                user: personSelect,
                planName: true,
                amount: true,
                refundedAmount: true,
                currency: true,
                provider: true,
                activationError: true,
            },
        }),
    ])
    return { total, rows }
}

// ---- One entry ----

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// `sub:<uuid>` / `reg:<uuid>` / `ref:<uuid>` → the source row; anything else
// → null.
export const parseJournalEntryId = (
    entryId: string,
): { source: 'abonement' | 'ticket' | 'refund'; id: string } | null => {
    const [prefix, id, ...rest] = entryId.split(':')
    if (rest.length > 0 || !id || !UUID.test(id)) return null
    if (prefix === 'sub') return { source: 'abonement', id }
    if (prefix === 'reg') return { source: 'ticket', id }
    if (prefix === 'ref') return { source: 'refund', id }
    return null
}

// A paid sale or a sale's refund of this club by its journal id; null when it
// is not one (an unpaid or foreign row is not in the journal, nor is the
// refund of an unapplied payment).
export const loadJournalEntry = async (
    prisma: PrismaService,
    workspaceId: string,
    entryId: string,
): Promise<JournalRow | null> => {
    const key = parseJournalEntryId(entryId)
    if (!key) return null
    if (key.source === 'abonement') {
        const s = await prisma.subscription.findFirst({
            where: { id: key.id, workspaceId, isPaid: true },
            select: journalSubscriptionSelect,
        })
        return s ? subscriptionJournalRow(s) : null
    }
    if (key.source === 'refund') {
        const r = await prisma.refund.findFirst({
            where: {
                id: key.id,
                workspaceId,
                OR: [{ subscriptionId: { not: null } }, { eventRegistrationId: { not: null } }],
            },
            select: journalRefundSelect,
        })
        return r ? refundJournalRow(r) : null
    }
    const t = await prisma.eventRegistration.findFirst({
        where: { id: key.id, workspaceId, isPaid: true },
        select: journalTicketSelect,
    })
    return t ? ticketJournalRow(t) : null
}

// A sale's refunds, newest first (none for a refund row).
export const loadSaleRefunds = async (
    prisma: PrismaService,
    workspaceId: string,
    row: JournalRow,
): Promise<JournalRow[]> => {
    if (row.kind !== 'payment') return []
    const refunds = await prisma.refund.findMany({
        where: {
            workspaceId,
            ...(row.source === 'abonement'
                ? { subscriptionId: row.rawId }
                : { eventRegistrationId: row.rawId }),
        },
        orderBy: refundOrderBy,
        select: journalRefundSelect,
    })
    return refunds.map(refundJournalRow)
}

// Refunding everything still refundable on this row would cancel the
// registration (refund.service → cancelByClubInTx): a ticket whose place is
// live and whose event has not started.
export const fullRefundCancelsRegistration = async (
    prisma: PrismaService,
    row: JournalRow,
    now: Date,
): Promise<boolean> => {
    if (row.kind !== 'payment' || row.source !== 'ticket') return false
    if (row.amount - row.refundedAmount <= 0) return false
    const reg = await prisma.eventRegistration.findUnique({
        where: { id: row.rawId },
        select: { status: true, event: { select: { startAt: true } } },
    })
    return (
        !!reg &&
        (reg.status === 'BOOKED' || reg.status === 'WAITLISTED') &&
        reg.event.startAt.getTime() > now.getTime()
    )
}
