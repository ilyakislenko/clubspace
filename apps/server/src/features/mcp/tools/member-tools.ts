import { z } from 'zod'

import { loadWorkspaceRisk } from '../../../domains/retention/load-workspace-risk'
import {
    RISK_REASONS,
    summarizeRisk,
} from '../../../domains/retention/risk-signals'
import {
    currentSubscriptionOrderBy,
    currentSubscriptionWhere,
} from '../../../domains/subscriptions/current-subscriptions'
import { ymdToDbDate } from '../../../domains/subscriptions/freeze-dates'
import type { Prisma } from '../../../infrastructure/prisma'
import { localDateInTz } from '../../attendance/attendance-utils'
import { awaitingPaymentWhere } from '../../get-workspace-stats/revenue'
import { capResult, defineTool, McpToolContext, McpToolError, pageInput, paginate } from '../mcp-tool'
import {
    assertDirectionArg,
    assertGroupArg,
    iso,
    resolveMemberRef,
    scopedStudentIds,
    uuidArg,
} from './tool-helpers'

const DAY_MS = 24 * 60 * 60 * 1000

const RISK_REASON_LABELS: Record<(typeof RISK_REASONS)[number], string> = {
    lapsed: 'Абонемент закончился и не продлён',
    newcomer: 'Новичок, который не закрепился',
    absent: 'Давно не приходил',
    declining: 'Стал ходить заметно реже',
}

const PSEUDONYM_QUERY_RE = /^m_[0-9a-f]{1,10}$/

// Groups of the token's scope a member trains in.
const groupsInScopeSelect = (ctx: McpToolContext) =>
    ({
        where: { group: ctx.scope.groups() },
        select: {
            group: {
                select: {
                    id: true,
                    name: true,
                    direction: { select: { id: true, name: true } },
                },
            },
        },
    }) as const

// Words of a name / phone / e-mail search, each matching some field.
const personalQueryWhere = (query: string): Prisma.WorkspaceMemberWhereInput => ({
    AND: query
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 4)
        .map((word) => {
            const digits = word.replace(/\D/g, '')
            return {
                user: {
                    OR: [
                        { firstname: { contains: word, mode: 'insensitive' as const } },
                        { lastname: { contains: word, mode: 'insensitive' as const } },
                        { email: { contains: word, mode: 'insensitive' as const } },
                        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
                    ],
                },
            }
        }),
})

export const searchMembersTool = defineTool({
    name: 'search_members',
    title: 'Поиск участников',
    description:
        'Список учеников клуба с фильтрами: статус, направление, группа, есть ли действующий абонемент. ' +
        'Для каждого: ref (псевдоним вида m_0123456789 — передавайте его в member_profile), группы, последний визит, действующие абонементы. ' +
        'Поиск query: в режиме «обезличено» — только по ref (имён, телефонов и e-mail ассистент не получает); ' +
        'с персональными данными — по имени, фамилии, телефону, e-mail. Постранично (offset/limit).',
    input: z.object({
        query: z
            .string()
            .trim()
            .min(1)
            .max(100)
            .optional()
            .describe('ref участника (m_…) или, в режиме с персональными данными, имя / телефон / e-mail'),
        status: z
            .enum(['active', 'inactive', 'all'])
            .default('active')
            .describe('active — действующие участники, inactive — приостановленные / ожидающие одобрения, all — все'),
        directionId: uuidArg('Только ученики групп этого направления').optional(),
        groupId: uuidArg('Только ученики этой группы').optional(),
        hasCurrentAbonement: z
            .boolean()
            .optional()
            .describe('true — только с действующим абонементом, false — только без него'),
        ...pageInput,
    }),
    run: async (ctx, args) => {
        const { prisma, scope, people, now } = ctx
        await assertDirectionArg(ctx, args.directionId)
        await assertGroupArg(ctx, args.groupId)

        let refQuery: string | null = null
        const filters: Prisma.WorkspaceMemberWhereInput[] = [scope.students()]
        if (args.status === 'active') filters.push({ status: 'ACTIVE' })
        if (args.status === 'inactive') filters.push({ status: { not: 'ACTIVE' } })
        if (args.groupId) {
            filters.push({ user: { groupMemberships: { some: { groupId: args.groupId } } } })
        }
        if (args.directionId) {
            filters.push({
                user: {
                    groupMemberships: {
                        some: { group: { workspaceId: scope.workspaceId, directionId: args.directionId } },
                    },
                },
            })
        }
        if (args.hasCurrentAbonement !== undefined) {
            filters.push(
                args.hasCurrentAbonement
                    ? { subscriptions: { some: currentSubscriptionWhere(now) } }
                    : { subscriptions: { none: currentSubscriptionWhere(now) } },
            )
        }
        if (args.query) {
            const q = args.query.toLowerCase()
            if (PSEUDONYM_QUERY_RE.test(q)) refQuery = q
            else if (people.personal) filters.push(personalQueryWhere(args.query))
            else {
                throw new McpToolError(
                    'В режиме «обезличено» поиск по имени, телефону и e-mail недоступен: ищите по ref (m_…) или используйте фильтры',
                )
            }
        }

        const matching = await prisma.workspaceMember.findMany({
            where: { AND: filters },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { userId: true },
        })
        const ids = matching
            .map((m) => m.userId)
            .filter((id) => refQuery === null || people.memberRef(id).startsWith(refQuery))
        const page = paginate(ids, args.offset, args.limit)

        const rows = await prisma.workspaceMember.findMany({
            where: { workspaceId: scope.workspaceId, userId: { in: page.items } },
            select: {
                userId: true,
                status: true,
                createdAt: true,
                accessUntil: true,
                lastAttendedAt: true,
                user: {
                    select: {
                        id: true,
                        firstname: true,
                        lastname: true,
                        email: true,
                        phone: true,
                        groupMemberships: groupsInScopeSelect(ctx),
                    },
                },
                subscriptions: {
                    where: currentSubscriptionWhere(now),
                    orderBy: currentSubscriptionOrderBy,
                    select: {
                        startDate: true,
                        endDate: true,
                        classesRemaining: true,
                        classesTotal: true,
                        plan: { select: { name: true } },
                    },
                },
            },
        })
        const byId = new Map(rows.map((r) => [r.userId, r]))
        const items = page.items.flatMap((id) => {
            const r = byId.get(id)
            if (!r) return []
            return [
                {
                    member: people.member(r.user),
                    status: r.status,
                    joinedAt: iso(r.createdAt),
                    accessUntil: iso(r.accessUntil),
                    lastVisitAt: iso(r.lastAttendedAt),
                    groups: r.user.groupMemberships.map((g) => g.group),
                    currentAbonements: r.subscriptions.map((s) => ({
                        tariff: s.plan.name,
                        startDate: iso(s.startDate),
                        endDate: iso(s.endDate),
                        classesRemaining: s.classesRemaining,
                        classesTotal: s.classesTotal,
                    })),
                },
            ]
        })
        return {
            rows: items.length,
            data: capResult({ total: page.total, nextOffset: page.nextOffset, items }),
        }
    },
})

export const memberProfileTool = defineTool({
    name: 'member_profile',
    title: 'Карточка участника',
    description:
        'Всё об одном ученике по его ref (m_…): группы, абонементы (действующие и последние), посещаемость за 30/90 дней, ' +
        'первый и последний визит, ранги по лестницам, ближайшие аттестации, признаки риска оттока. ' +
        'Для токена администратора — суммы абонементов и долг. Заметки тренеров и медицинские сведения не выдаются.',
    input: z.object({
        member: z.string().trim().min(3).max(20).describe('ref участника (m_…) из других ответов'),
    }),
    run: async (ctx, args) => {
        const { prisma, scope, people, now, access } = ctx
        const userId = await resolveMemberRef(ctx, args.member)
        const tz = access.timezone
        const todayYmd = localDateInTz(now, tz)
        const since30 = new Date(now.getTime() - 30 * DAY_MS)
        const since90 = new Date(now.getTime() - 90 * DAY_MS)
        const inScopeRecords = { workspaceId: scope.workspaceId, userId, session: scope.sessions() }
        // A direction manager sees abonements of their directions and
        // club-wide ones (those cover their classes too).
        const subscriptionScope: Prisma.SubscriptionWhereInput = scope.isAdmin
            ? {}
            : {
                  OR: [
                      { directions: { none: {} } },
                      { directions: { some: { directionId: { in: scope.directionIds ?? [] } } } },
                  ],
              }

        const [member, visits30d, visits90d, visitsTotal, bounds, promotions, candidacies, risk] =
            await Promise.all([
                prisma.workspaceMember.findUniqueOrThrow({
                    where: { userId_workspaceId: { userId, workspaceId: scope.workspaceId } },
                    select: {
                        id: true,
                        status: true,
                        createdAt: true,
                        accessUntil: true,
                        user: {
                            select: {
                                id: true,
                                firstname: true,
                                lastname: true,
                                email: true,
                                phone: true,
                                groupMemberships: groupsInScopeSelect(ctx),
                            },
                        },
                        subscriptions: {
                            where: subscriptionScope,
                            orderBy: { createdAt: 'desc' },
                            take: 10,
                            select: {
                                status: true,
                                startDate: true,
                                endDate: true,
                                classesRemaining: true,
                                classesTotal: true,
                                isPaid: true,
                                amountPaid: true,
                                currency: true,
                                createdAt: true,
                                plan: { select: { name: true } },
                                directions: { select: { direction: { select: { name: true } } } },
                                freezes: {
                                    where: { untilDate: { gte: ymdToDbDate(todayYmd) } },
                                    select: { fromDate: true, untilDate: true },
                                },
                            },
                        },
                    },
                }),
                prisma.attendanceRecord.count({ where: { ...inScopeRecords, markedAt: { gte: since30 } } }),
                prisma.attendanceRecord.count({ where: { ...inScopeRecords, markedAt: { gte: since90 } } }),
                prisma.attendanceRecord.count({ where: inScopeRecords }),
                prisma.attendanceRecord.aggregate({
                    where: inScopeRecords,
                    _min: { markedAt: true },
                    _max: { markedAt: true },
                }),
                prisma.rankPromotion.findMany({
                    where: { workspaceId: scope.workspaceId, userId, ladder: scope.ladders() },
                    orderBy: { awardedAt: 'desc' },
                    select: {
                        ladderId: true,
                        ladder: { select: { name: true } },
                        level: { select: { name: true } },
                        stripes: true,
                        awardedAt: true,
                    },
                }),
                prisma.rankGradingCandidate.findMany({
                    where: {
                        workspaceId: scope.workspaceId,
                        userId,
                        grading: { ladder: scope.ladders(), date: { gte: ymdToDbDate(todayYmd) } },
                    },
                    select: {
                        stripes: true,
                        result: true,
                        level: { select: { name: true } },
                        grading: { select: { title: true, date: true } },
                    },
                }),
                loadWorkspaceRisk(prisma, { workspaceId: scope.workspaceId, now, userIds: [userId] }),
            ])

        const seenLadders = new Set<string>()
        const ranks = promotions.flatMap((p) => {
            if (seenLadders.has(p.ladderId)) return []
            seenLadders.add(p.ladderId)
            return [{ ladder: p.ladder.name, level: p.level.name, stripes: p.stripes, since: iso(p.awardedAt) }]
        })
        const entry = risk[0]
        let unpaid: Record<string, unknown> | null = null
        if (scope.isAdmin) {
            const debts = await prisma.subscription.findMany({
                where: { ...awaitingPaymentWhere(scope.workspaceId), workspaceMemberId: member.id },
                select: { amountPaid: true, currency: true },
            })
            unpaid = {
                count: debts.length,
                amounts: debts.map((d) => ({ amount: d.amountPaid, currency: d.currency })),
            }
        }

        return {
            rows: 1,
            data: {
                member: people.member(member.user),
                status: member.status,
                joinedAt: iso(member.createdAt),
                accessUntil: iso(member.accessUntil),
                groups: member.user.groupMemberships.map((g) => g.group),
                abonements: member.subscriptions.map((s) => ({
                    tariff: s.plan.name,
                    status: s.status,
                    soldAt: iso(s.createdAt),
                    startDate: iso(s.startDate),
                    endDate: iso(s.endDate),
                    classesRemaining: s.classesRemaining,
                    classesTotal: s.classesTotal,
                    frozenOrFreezePlanned: s.freezes.length > 0,
                    directions: s.directions.map((d) => d.direction.name),
                    isPaid: s.isPaid,
                    ...(scope.isAdmin ? { amount: s.amountPaid, currency: s.currency } : {}),
                })),
                attendance: {
                    visits30d,
                    visits90d,
                    visitsTotal,
                    firstVisitAt: iso(bounds._min.markedAt),
                    lastVisitAt: iso(bounds._max.markedAt),
                },
                ranks,
                upcomingGradings: candidacies.map((c) => ({
                    title: c.grading.title,
                    date: c.grading.date.toISOString().slice(0, 10),
                    target: c.level.name,
                    stripes: c.stripes,
                    result: c.result,
                })),
                risk: entry
                    ? {
                          reason: entry.risk.reason,
                          reasonLabel: RISK_REASON_LABELS[entry.risk.reason],
                          signals: entry.risk.signals,
                          summary: entry.factsText,
                          snoozed: entry.snoozed,
                      }
                    : null,
                unpaid,
            },
        }
    },
})

export const atRiskMembersTool = defineTool({
    name: 'at_risk_members',
    title: 'Кто может уйти',
    description:
        'Ученики в зоне риска оттока (тот же список, что «Кто пропадает» в админке): ' +
        'lapsed — абонемент закончился и не продлён, newcomer — новичок не закрепился, absent — давно не приходил, declining — стал ходить реже. ' +
        'Для каждого — причина, пояснение, последний визит, группы и когда с ним последний раз связывались. ' +
        'По умолчанию без тех, с кем недавно связывались (snoozed). Постранично.',
    input: z.object({
        reason: z.enum(RISK_REASONS).optional().describe('Только с этой главной причиной'),
        directionId: uuidArg('Только ученики групп этого направления').optional(),
        groupId: uuidArg('Только ученики этой группы').optional(),
        includeSnoozed: z
            .boolean()
            .default(false)
            .describe('Включить тех, с кем уже связались за последние дни'),
        ...pageInput,
    }),
    run: async (ctx, args) => {
        const { prisma, scope, people, now } = ctx
        await assertDirectionArg(ctx, args.directionId)
        await assertGroupArg(ctx, args.groupId)
        const userIds = scope.isAdmin ? undefined : await scopedStudentIds(ctx)
        const entries =
            userIds !== undefined && userIds.length === 0
                ? []
                : await loadWorkspaceRisk(prisma, { workspaceId: scope.workspaceId, now, userIds })

        const scopeGroups = await prisma.group.findMany({
            where: {
                AND: [scope.groups(), args.directionId ? { directionId: args.directionId } : {}],
            },
            select: { id: true },
        })
        const allowedGroups = new Set(scopeGroups.map((g) => g.id))
        const narrowByGroups = !scope.isAdmin || args.directionId !== undefined
        const inScope = entries
            .map((e) => ({ ...e, groups: e.groups.filter((g) => allowedGroups.has(g.id)) }))
            .filter(
                (e) =>
                    (!narrowByGroups || e.groups.length > 0) &&
                    (!args.groupId || e.groups.some((g) => g.id === args.groupId)),
            )
        const summary = summarizeRisk(inScope)
        const listed = inScope.filter(
            (e) => (args.includeSnoozed || !e.snoozed) && (!args.reason || e.risk.reason === args.reason),
        )
        const page = paginate(listed, args.offset, args.limit)
        const items = page.items.map((e) => ({
            member: people.member({
                id: e.userId,
                firstname: e.firstname,
                lastname: e.lastname,
                email: e.email,
                phone: e.phone,
            }),
            reason: e.risk.reason,
            reasonLabel: RISK_REASON_LABELS[e.risk.reason],
            signals: e.risk.signals,
            summary: e.factsText,
            lastVisitAt: iso(e.risk.facts.lastVisitAt),
            daysSinceLastVisit: e.risk.facts.daysSinceLastVisit,
            groups: e.groups.map((g) => ({ id: g.id, name: g.name })),
            lastContactAt: iso(e.lastContact?.at),
            snoozed: e.snoozed,
        }))
        return {
            rows: items.length,
            data: capResult({ summary, total: page.total, nextOffset: page.nextOffset, items }),
        }
    },
})
