// «Пробные» (docs/design/2026-11-26-leads.md §1): the single definition of a
// lead's pipeline, «Купил», «нужно действие», duplicates and retention. Every
// handler, report, job and export reads these; none writes its own `where`.

import type { Prisma } from '../../infrastructure/prisma'
import { paidInRangeWhere } from '../metrics/revenue'

const DAY_MS = 24 * 60 * 60_000

export const LEAD_STATUSES = [
    'NEW',
    'CONTACTED',
    'TRIAL_BOOKED',
    'CAME',
    'LOST',
] as const
export type LeadStatusValue = (typeof LEAD_STATUSES)[number]

// The displayed status: the stored one, or BOUGHT (derived, never stored).
export const LEAD_DISPLAY_STATUSES = [...LEAD_STATUSES, 'BOUGHT'] as const
export type LeadDisplayStatus = (typeof LEAD_DISPLAY_STATUSES)[number]

export const LEAD_SOURCES = ['PUBLIC_PAGE', 'QR', 'MANUAL'] as const
export type LeadSourceValue = (typeof LEAD_SOURCES)[number]

export const LEAD_LOST_REASONS = [
    'NO_ANSWER',
    'CHANGED_MIND',
    'PRICE',
    'SCHEDULE',
    'LOCATION',
    'CHOSE_OTHER',
    'SPAM',
    'OTHER',
] as const
export type LeadLostReasonValue = (typeof LEAD_LOST_REASONS)[number]

export const LEAD_SOURCE_LABELS: Record<LeadSourceValue, string> = {
    PUBLIC_PAGE: 'Страница клуба',
    QR: 'QR-плакат',
    MANUAL: 'Вручную',
}

export const LEAD_STATUS_LABELS: Record<LeadDisplayStatus, string> = {
    NEW: 'Новая',
    CONTACTED: 'Связались',
    TRIAL_BOOKED: 'Записан на пробное',
    CAME: 'Пришёл',
    BOUGHT: 'Купил',
    LOST: 'Отказ',
}

export const LEAD_LOST_REASON_LABELS: Record<LeadLostReasonValue, string> = {
    NO_ANSWER: 'Не дозвонились',
    CHANGED_MIND: 'Передумал',
    PRICE: 'Не подошла цена',
    SCHEDULE: 'Не подошло расписание',
    LOCATION: 'Далеко',
    CHOSE_OTHER: 'Выбрал другой клуб',
    SPAM: 'Спам',
    OTHER: 'Другое',
}

// Retention (constants, not env: the consent text quotes them).
export const LEAD_CLOSED_RETENTION_DAYS = 90
export const LEAD_IDLE_DAYS = 180
// The same phone within this window merges into the open lead.
export const LEAD_DUPLICATE_DAYS = 30
// Public requests one club takes per rolling 24 h before answering 429.
export const LEAD_PUBLIC_DAILY_CAP = 50
// A NEW lead older than this «ждёт звонка» (the morning lead.stale push).
export const LEAD_STALE_HOURS = 24

// Pipeline order; LOST is off the line.
const RANK: Record<Exclude<LeadStatusValue, 'LOST'>, number> = {
    NEW: 0,
    CONTACTED: 1,
    TRIAL_BOOKED: 2,
    CAME: 3,
}

// Staff may jump forward and reschedule a booked trial (TRIAL_BOOKED again);
// LOST is reachable from any open status; the only way back is «Вернуть в
// работу» (LOST → CONTACTED).
export const canMoveLead = (
    from: LeadStatusValue,
    to: LeadStatusValue,
): boolean => {
    if (from === 'LOST') return to === 'CONTACTED'
    if (to === 'LOST') return true
    if (from === 'TRIAL_BOOKED' && to === 'TRIAL_BOOKED') return true
    return RANK[to] > RANK[from]
}

// The columns a move stamps. The first contact is stamped once — by any move
// past NEW, and never moved by «Вернуть в работу» — so the report's «через
// сколько перезваниваем» stays honest. «Вернуть в работу» clears the refusal.
export const leadStatusStamp = (
    to: LeadStatusValue,
    now: Date,
    current: { contactedAt: Date | null },
): Prisma.LeadUpdateManyMutationInput => {
    const base = { status: to, statusChangedAt: now }
    const contactedAt = current.contactedAt ?? now
    switch (to) {
        case 'NEW':
            return base
        case 'CONTACTED':
            return {
                ...base,
                contactedAt,
                lostAt: null,
                lostReason: null,
                lostComment: null,
            }
        case 'TRIAL_BOOKED':
            return { ...base, contactedAt, trialBookedAt: now }
        case 'CAME':
            return { ...base, contactedAt, cameAt: now }
        case 'LOST':
            return { ...base, lostAt: now }
    }
}

// Not refused, not added to the club, not anonymised.
export const openLeadWhere = {
    status: { not: 'LOST' },
    convertedUserId: null,
    anonymizedAt: null,
} satisfies Prisma.LeadWhereInput

// «Нужно действие»: a new lead, or a booked trial whose time has passed
// without a mark.
export const needsActionWhere = (now: Date): Prisma.LeadWhereInput => ({
    anonymizedAt: null,
    OR: [{ status: 'NEW' }, { status: 'TRIAL_BOOKED', trialAt: { lt: now } }],
})

// An open lead of the club with this normalised phone, created within the
// duplicate window.
export const duplicateWhere = (p: {
    workspaceId: string
    phone: string
    now: Date
}): Prisma.LeadWhereInput => ({
    workspaceId: p.workspaceId,
    phone: p.phone,
    ...openLeadWhere,
    createdAt: { gte: new Date(p.now.getTime() - LEAD_DUPLICATE_DAYS * DAY_MS) },
})

// The abonement that makes a linked lead «Купил»: paid (the revenue rule),
// money received, not a free trial tariff, of this club.
export const boughtSubscriptionWhere = (
    workspaceId: string,
): Prisma.SubscriptionWhereInput => ({
    workspaceId,
    ...paidInRangeWhere({}),
    amountPaid: { gt: 0 },
    plan: { isFreeTrial: false },
})

// Leads whose linked member holds such an abonement.
export const boughtUserWhere = (workspaceId: string): Prisma.LeadWhereInput => ({
    convertedUser: {
        is: { subscriptions: { some: boughtSubscriptionWhere(workspaceId) } },
    },
})

export const displayStatus = (
    lead: { status: LeadStatusValue },
    bought: boolean,
): LeadDisplayStatus => (bought ? 'BOUGHT' : lead.status)

export const isNeedsAction = (
    lead: { status: LeadStatusValue; trialAt: Date | null; anonymizedAt: Date | null },
    now: Date,
): boolean =>
    lead.anonymizedAt === null &&
    (lead.status === 'NEW' ||
        (lead.status === 'TRIAL_BOOKED' &&
            lead.trialAt !== null &&
            lead.trialAt < now))

// Closed leads past the retention term, still holding personal data.
export const retentionWhere = (now: Date): Prisma.LeadWhereInput => {
    const cutoff = new Date(now.getTime() - LEAD_CLOSED_RETENTION_DAYS * DAY_MS)
    return {
        anonymizedAt: null,
        OR: [
            { status: 'LOST', lostAt: { lt: cutoff } },
            { convertedAt: { lt: cutoff } },
        ],
    }
}

// Open leads without a move for LEAD_IDLE_DAYS: closed as LOST NO_ANSWER and
// anonymised in the same pass (the consent promises at most 180 days).
export const idleWhere = (now: Date): Prisma.LeadWhereInput => ({
    ...openLeadWhere,
    statusChangedAt: { lt: new Date(now.getTime() - LEAD_IDLE_DAYS * DAY_MS) },
})

// Nulls every personal field. Source, statuses, dates, direction, reason and
// the link stay, so the report keeps counting the lead.
export const anonymizeData = (now: Date) =>
    ({
        name: null,
        phone: null,
        email: null,
        childName: null,
        comment: null,
        staffNote: null,
        lostComment: null,
        consentIp: null,
        consentUserAgent: null,
        anonymizedAt: now,
    }) satisfies Prisma.LeadUpdateManyMutationInput

// The idle close: LOST NO_ANSWER, stamped now, anonymised at once.
export const idleCloseData = (now: Date) =>
    ({
        status: 'LOST',
        lostReason: 'NO_ANSWER',
        lostAt: now,
        statusChangedAt: now,
        ...anonymizeData(now),
    }) satisfies Prisma.LeadUpdateManyMutationInput

// The digits of a search string, for matching a stored «+7…» phone.
export const phoneDigits = (q: string): string => q.replace(/\D/g, '')
