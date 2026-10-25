import {
    localDateInTz,
    wallClockToUtc,
} from '../../features/attendance/attendance-utils'
import { displayName } from '../../features/attendance/schemas'
import { PrismaService } from '../../infrastructure/prisma'
import {
    addDaysYmd,
    dbDateToYmd,
    DAY_MS,
    ymdToDbDate,
} from '../subscriptions/freeze-dates'
import { subscriptionUsabilitySelect } from '../subscriptions/subscription-status'
import {
    describeRisk,
    evaluateMemberRisk,
    isSnoozed,
    RISK_REASONS,
    RISK_RULES,
    type MemberRisk,
    type RiskReason,
} from './risk-signals'

export type WorkspaceRiskEntry = {
    userId: string
    firstname: string | null
    lastname: string | null
    email: string
    phone: string | null
    groups: {
        id: string
        name: string
        gymId: string | null
        gymName: string | null
    }[]
    risk: MemberRisk
    factsText: string
    lastContact: {
        id: string
        at: Date
        byName: string
        note: string | null
        reason: RiskReason | null
        signals: RiskReason[]
    } | null
    snoozed: boolean
}

const asReason = (s: string): RiskReason | null =>
    (RISK_REASONS as readonly string[]).includes(s) ? (s as RiskReason) : null

const asReasons = (list: string[]): RiskReason[] =>
    list.map(asReason).filter((r): r is RiskReason => r !== null)

// One engine pass over a workspace: the in-scope members first, then every
// other query in parallel narrowed to those members (so the all-time visit
// bounds never scan staff or former members); no per-member queries. A plain
// function (not a provider) so the handler and the weekly digest both call it.
// `userIds` narrows further; the club-wide "is attendance being marked at all"
// probe is never narrowed.
export const loadWorkspaceRisk = async (
    prisma: PrismaService,
    p: { workspaceId: string; now: Date; userIds?: string[] },
): Promise<WorkspaceRiskEntry[]> => {
    const { workspaceId, now } = p
    const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { ownerId: true, timezone: true },
    })
    if (!workspace) return []
    const tz = workspace.timezone
    const todayYmd = localDateInTz(now, tz)
    const windowStart = new Date(now.getTime() - RISK_RULES.windowDays * DAY_MS)
    const guardStart = new Date(
        now.getTime() - RISK_RULES.activityGuardDays * DAY_MS,
    )
    const snoozeStart = new Date(
        now.getTime() - RISK_RULES.contactSnoozeDays * DAY_MS,
    )

    const members = await prisma.workspaceMember.findMany({
        where: {
            workspaceId,
            status: 'ACTIVE',
            role: { name: 'user' },
            userId: {
                not: workspace.ownerId,
                ...(p.userIds ? { in: p.userIds } : {}),
            },
            user: { deletedAt: null },
        },
        select: {
            userId: true,
            accessUntil: true,
            user: {
                select: {
                    firstname: true,
                    lastname: true,
                    email: true,
                    phone: true,
                },
            },
            subscription: {
                select: {
                    classesRemaining: true,
                    plan: { select: { name: true } },
                    ...subscriptionUsabilitySelect,
                },
            },
        },
    })
    // Only the people the engine can flag: the narrowing for every query below.
    const U = { userId: { in: members.map((m) => m.userId) } }

    const [visitBounds, windowRows, activeProbe, freezes, groupRows, contacts] =
        await Promise.all([
            prisma.attendanceRecord.groupBy({
                by: ['userId'],
                where: { workspaceId, ...U },
                _min: { markedAt: true },
                _max: { markedAt: true },
            }),
            prisma.attendanceRecord.findMany({
                where: { workspaceId, markedAt: { gte: windowStart }, ...U },
                select: { userId: true, markedAt: true },
            }),
            prisma.attendanceRecord.findFirst({
                where: { workspaceId, markedAt: { gte: guardStart } },
                select: { id: true },
            }),
            prisma.subscriptionFreeze.findMany({
                where: {
                    workspaceId,
                    ...U,
                    // Also freezes starting soon: that member is about to be
                    // away on purpose, so calling them now is noise.
                    fromDate: {
                        lte: ymdToDbDate(
                            addDaysYmd(todayYmd, RISK_RULES.freezeLookaheadDays),
                        ),
                    },
                    untilDate: {
                        gte: ymdToDbDate(
                            addDaysYmd(todayYmd, -RISK_RULES.windowDays),
                        ),
                    },
                },
                select: {
                    userId: true,
                    untilDate: true,
                    subscription: { select: { status: true } },
                },
            }),
            prisma.groupMember.findMany({
                where: { group: { workspaceId }, ...U },
                select: {
                    userId: true,
                    group: {
                        select: {
                            id: true,
                            name: true,
                            gymId: true,
                            gym: { select: { name: true } },
                        },
                    },
                },
            }),
            prisma.memberRetentionContact.findMany({
                where: { workspaceId, createdAt: { gte: snoozeStart }, ...U },
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    userId: true,
                    createdAt: true,
                    note: true,
                    reason: true,
                    signals: true,
                    contactedBy: {
                        select: { firstname: true, lastname: true, email: true },
                    },
                },
            }),
        ])

    const bounds = new Map(
        visitBounds.map((b) => [
            b.userId,
            { first: b._min.markedAt, last: b._max.markedAt },
        ]),
    )
    const visitsByUser = new Map<string, Date[]>()
    for (const r of windowRows) {
        const list = visitsByUser.get(r.userId)
        if (list) list.push(r.markedAt)
        else visitsByUser.set(r.userId, [r.markedAt])
    }

    // Same rule as roster.ts: a freeze counts as "now" only while its
    // abonement is still ACTIVE. An upcoming freeze (starting within
    // `freezeLookaheadDays`) is treated the same way.
    const frozenNow = new Set<string>()
    const lastFreezeEnd = new Map<string, Date>()
    for (const f of freezes) {
        if (dbDateToYmd(f.untilDate) >= todayYmd) {
            if (f.subscription.status === 'ACTIVE') frozenNow.add(f.userId)
            continue
        }
        const end = wallClockToUtc(
            `${addDaysYmd(dbDateToYmd(f.untilDate), 1)}T00:00`,
            tz,
        )
        const prev = lastFreezeEnd.get(f.userId)
        if (!prev || end > prev) lastFreezeEnd.set(f.userId, end)
    }

    const groupsByUser = new Map<string, WorkspaceRiskEntry['groups']>()
    for (const g of groupRows) {
        const entry = {
            id: g.group.id,
            name: g.group.name,
            gymId: g.group.gymId,
            gymName: g.group.gym?.name ?? null,
        }
        const list = groupsByUser.get(g.userId)
        if (list) list.push(entry)
        else groupsByUser.set(g.userId, [entry])
    }

    // Newest first, so the first row seen per user is the latest contact.
    const contactByUser = new Map<string, (typeof contacts)[number]>()
    for (const c of contacts) {
        if (!contactByUser.has(c.userId)) contactByUser.set(c.userId, c)
    }

    const attendanceActive = !!activeProbe
    const entries: WorkspaceRiskEntry[] = []
    for (const m of members) {
        const b = bounds.get(m.userId)
        const risk = evaluateMemberRisk({
            now,
            tz,
            attendanceActive,
            firstVisitAt: b?.first ?? null,
            lastVisitAt: b?.last ?? null,
            windowVisits: visitsByUser.get(m.userId) ?? [],
            frozenNow: frozenNow.has(m.userId),
            lastFreezeEndAt: lastFreezeEnd.get(m.userId) ?? null,
            subscription: m.subscription
                ? {
                      status: m.subscription.status,
                      endDate: m.subscription.endDate,
                      classesRemaining: m.subscription.classesRemaining,
                      planName: m.subscription.plan.name,
                  }
                : null,
            accessUntil: m.accessUntil,
        })
        if (!risk) continue

        const c = contactByUser.get(m.userId)
        const lastContact = c
            ? {
                  id: c.id,
                  at: c.createdAt,
                  byName: displayName(c.contactedBy),
                  note: c.note,
                  reason: c.reason ? asReason(c.reason) : null,
                  signals: asReasons(c.signals),
              }
            : null
        entries.push({
            userId: m.userId,
            firstname: m.user.firstname,
            lastname: m.user.lastname,
            email: m.user.email,
            phone: m.user.phone,
            groups: groupsByUser.get(m.userId) ?? [],
            risk,
            factsText: describeRisk(risk, tz),
            lastContact,
            snoozed: isSnoozed(lastContact, risk, now),
        })
    }

    return entries.sort((a, b) => {
        const byReason =
            RISK_REASONS.indexOf(a.risk.reason) -
            RISK_REASONS.indexOf(b.risk.reason)
        if (byReason !== 0) return byReason
        const da = a.risk.facts.daysSinceLastVisit
        const db = b.risk.facts.daysSinceLastVisit
        if (da !== db) {
            if (da == null) return 1
            if (db == null) return -1
            return db - da
        }
        return displayName(a).localeCompare(displayName(b), 'ru')
    })
}
