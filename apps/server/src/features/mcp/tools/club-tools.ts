import { z } from 'zod'

import { loadWorkspaceRisk } from '../../../domains/retention/load-workspace-risk'
import { summarizeRisk } from '../../../domains/retention/risk-signals'
import { countStudentsWithAbonement } from '../../../domains/metrics/abonements'
import { countActiveStudents } from '../../../domains/metrics/active-students'
import { countNewStudents, countStudents, type StudentScope } from '../../../domains/metrics/students'
import { ymdToDbDate } from '../../../domains/subscriptions/freeze-dates'
import { localDateInTz } from '../../attendance/attendance-utils'
import { awaitingPaymentWhere } from '../../../domains/subscriptions/renewal-rules'
import {
    computeRevenue,
    dominantCurrency,
    loadCurrentSales,
    loadRefunds,
    loadSales,
    netRevenue,
    paidOn,
    revenueTrendStart,
    revenueWindowStart,
    summarizeAwaiting,
} from '../../../domains/metrics/revenue'
import { countOpenRequests, type RequestCounts } from '../../../domains/requests/open-requests'
import { appFeatureSelect, toAppFeatureFlags } from '../../../domains/workspace/feature-flags'
import { ownGroupsWhere } from '../../../shared/services/rbac.service'
import { defineTool, type McpToolContext } from '../mcp-tool'
import { groupRef, planRef, scopedStudentIds } from './tool-helpers'

const DAY_MS = 24 * 60 * 60 * 1000
const LIST_CAP = 200

export const clubDirectoryTool = defineTool({
    name: 'club_directory',
    title: 'Справочник клуба',
    description:
        'Справочник клуба: направления, залы, группы (с тренерами и числом участников), действующие тарифы и лестницы рангов с их id. ' +
        'Вызовите первым, чтобы узнать id для фильтров других инструментов (directionId, gymId, groupId, planId, ladderId). ' +
        'Токен руководителя направления видит только свои направления.',
    input: z.object({}),
    run: async (ctx) => {
        const { prisma, scope, people } = ctx
        const [directions, gyms, groups, plans, ladders] = await Promise.all([
            prisma.direction.findMany({
                where: scope.directions(),
                orderBy: [{ order: 'asc' }, { name: 'asc' }],
                take: LIST_CAP,
                select: { id: true, name: true, isActive: true },
            }),
            prisma.gym.findMany({
                where: { workspaceId: scope.workspaceId },
                orderBy: { name: 'asc' },
                take: LIST_CAP,
                select: { id: true, name: true, address: true, timezone: true },
            }),
            prisma.group.findMany({
                where: scope.groups(),
                orderBy: { name: 'asc' },
                take: LIST_CAP,
                select: {
                    id: true,
                    name: true,
                    gym: { select: { id: true, name: true } },
                    direction: { select: { id: true, name: true } },
                    coaches: {
                        orderBy: { role: 'desc' },
                        select: {
                            role: true,
                            user: { select: { id: true, firstname: true, lastname: true } },
                        },
                    },
                    _count: { select: { members: true } },
                },
            }),
            prisma.plan.findMany({
                where: { ...scope.plans(), isActive: true },
                orderBy: { price: 'asc' },
                take: LIST_CAP,
                select: {
                    id: true,
                    name: true,
                    price: true,
                    currency: true,
                    classCount: true,
                    durationDays: true,
                    isFreeTrial: true,
                    startsOnFirstVisit: true,
                    directions: { select: { direction: { select: { id: true, name: true } } } },
                },
            }),
            prisma.rankLadder.findMany({
                where: { ...scope.ladders(), isActive: true },
                orderBy: { order: 'asc' },
                take: LIST_CAP,
                select: {
                    id: true,
                    name: true,
                    direction: { select: { id: true, name: true } },
                    _count: { select: { levels: true } },
                },
            }),
        ])
        return {
            rows: directions.length + gyms.length + groups.length + plans.length + ladders.length,
            data: {
                directions,
                gyms,
                groups: groups.map((g) => ({
                    id: g.id,
                    ref: groupRef(g.id),
                    name: g.name,
                    gym: g.gym,
                    direction: g.direction,
                    members: g._count.members,
                    coaches: g.coaches.map((c) => ({
                        ...people.staff(c.user),
                        role: c.role === 'primary' ? 'основной' : 'помощник',
                    })),
                })),
                tariffs: plans.map((p) => ({
                    id: p.id,
                    ref: planRef(p.id),
                    name: p.name,
                    price: p.price,
                    currency: p.currency,
                    classes: p.classCount,
                    durationDays: p.durationDays,
                    isFreeTrial: p.isFreeTrial,
                    startsOnFirstVisit: p.startsOnFirstVisit,
                    // Empty = весь клуб.
                    directions: p.directions.map((d) => d.direction),
                })),
                ladders: ladders.map((l) => ({
                    id: l.id,
                    name: l.name,
                    direction: l.direction,
                    levels: l._count.levels,
                })),
            },
        }
    },
})

// «Заявки» waiting on the token's creator: the inbox's rule (domains/requests)
// with the viewer built from AiAccess — admin scope sees the club, a
// direction manager their groups' members and their own personal requests.
const countClubRequests = async (ctx: McpToolContext): Promise<RequestCounts> => {
    const { prisma, access, scope, now } = ctx
    const workspace = await prisma.workspace.findUniqueOrThrow({
        where: { id: scope.workspaceId },
        select: appFeatureSelect,
    })
    const sections = toAppFeatureFlags(workspace, now)
    return countOpenRequests(
        prisma,
        {
            workspaceId: scope.workspaceId,
            userId: access.userId,
            clubWide: scope.isAdmin,
            clubAdmin: access.isClubAdmin,
            // rbac.ownGroupMemberIds: students of the groups they coach or
            // whose direction they run.
            ownGroupMemberIds: async () =>
                (
                    await prisma.groupMember.findMany({
                        where: {
                            group: {
                                workspaceId: scope.workspaceId,
                                ...ownGroupsWhere(access.userId),
                            },
                        },
                        distinct: ['userId'],
                        select: { userId: true },
                    })
                ).map((m) => m.userId),
            sections: { subscription: sections.subscription, videos: sections.videos },
        },
        now,
    )
}

export const clubOverviewTool = defineTool({
    name: 'club_overview',
    title: 'Сводка по клубу',
    description:
        'Главные цифры клуба на сейчас — те же, что на странице «Сегодня» в админке: ученики (всего; активные — были на занятии или ' +
        'открывали приложение за 30 дней; новые за 30 дней; с действующим абонементом), посещаемость за 7 и 30 дней, ' +
        'сколько учеников в зоне риска оттока, ближайшие события и аттестации. ' +
        'Для токена администратора — ещё выручка за 30 дней и текущий месяц и сумма неоплаченных абонементов. ' +
        'Ещё — сколько заявок ждёт решения (вступление, заморозка, персональные, разборы видео): те, что владелец токена может решить сам, как во вкладке «Заявки». ' +
        'И сообщения клуба ученикам за 30 дней: сколько отправлено, сколько получателей и какая доля открыла (только чтение — отправлять ассистент не может). ' +
        'Хорошая отправная точка для вопросов «как дела в клубе».',
    input: z.object({}),
    run: async (ctx) => {
        const { prisma, scope, access, now } = ctx
        const tz = access.timezone
        const since7 = new Date(now.getTime() - 7 * DAY_MS)
        const since30 = new Date(now.getTime() - 30 * DAY_MS)
        const in7 = new Date(now.getTime() + 7 * DAY_MS)
        const todayYmd = localDateInTz(now, tz)
        // The dashboard's student metrics (domains/metrics), narrowed to a
        // direction manager's directions.
        const studentScope: StudentScope = {
            workspaceId: scope.workspaceId,
            ownerId: access.ownerId,
            ...(scope.isAdmin ? {} : { where: scope.students() }),
        }
        const recordsSince = (gte: Date) => ({
            workspaceId: scope.workspaceId,
            markedAt: { gte },
            session: scope.sessions(),
        })

        const [
            total,
            active,
            new30d,
            groups,
            directions,
            checkins7d,
            checkins30d,
            attendees30d,
            sessions30d,
            withAbonement,
            events7d,
            gradings,
        ] = await Promise.all([
            countStudents(prisma, studentScope),
            countActiveStudents(prisma, studentScope, now),
            countNewStudents(prisma, studentScope, since30),
            prisma.group.count({ where: scope.groups() }),
            prisma.direction.findMany({
                where: scope.directions(),
                orderBy: { order: 'asc' },
                select: { name: true },
            }),
            prisma.attendanceRecord.count({ where: recordsSince(since7) }),
            prisma.attendanceRecord.count({ where: recordsSince(since30) }),
            prisma.attendanceRecord.findMany({
                where: recordsSince(since30),
                distinct: ['userId'],
                select: { userId: true },
            }),
            prisma.attendanceSession.count({
                where: { ...scope.sessions(), startAt: { gte: since30, lte: now } },
            }),
            countStudentsWithAbonement(prisma, studentScope, now),
            prisma.workspaceEvent.count({
                where: { ...scope.events(), startAt: { gte: now, lt: in7 } },
            }),
            prisma.rankGrading.count({
                where: {
                    workspaceId: scope.workspaceId,
                    ladder: scope.ladders(),
                    date: { gte: ymdToDbDate(todayYmd) },
                },
            }),
        ])

        const userIds = scope.isAdmin ? undefined : await scopedStudentIds(ctx)
        const risk =
            userIds !== undefined && userIds.length === 0
                ? []
                : await loadWorkspaceRisk(prisma, {
                      workspaceId: scope.workspaceId,
                      now,
                      userIds,
                  })

        let money: Record<string, unknown> | null = null
        if (scope.seesMoney) {
            // The dashboard's `revenue_30d` (computeRevenue over the same
            // loaders: sales − refunds of sales, its currency) and the same
            // rule since the 1st of the club-local month.
            const monthStart = revenueTrendStart(now, tz, 1)
            const since = revenueWindowStart(now)
            const windowStart = monthStart < since ? monthStart : since
            const [current, sales, refunds, awaiting] = await Promise.all([
                loadCurrentSales(prisma, scope.workspaceId, now),
                loadSales(prisma, scope.workspaceId, windowStart),
                loadRefunds(prisma, scope.workspaceId, windowStart),
                prisma.subscription.findMany({
                    where: awaitingPaymentWhere(scope.workspaceId),
                    select: { amountPaid: true, currency: true },
                }),
            ])
            const summary = computeRevenue(
                current,
                sales.filter((r) => paidOn(r) >= since),
                refunds.filter((r) => r.refundedAt >= since),
            )
            const currency = summary.currency ?? dominantCurrency(awaiting)
            money = {
                currency,
                revenue30d: summary.revenue30d,
                refunded30d: summary.refunded30d,
                revenueThisMonth: netRevenue(sales, refunds, summary.currency, { gte: monthStart }),
                unpaid: summarizeAwaiting(awaiting, currency),
                note: 'Суммы в целых единицах валюты; выручка — оплаченные абонементы и билеты на события по дате оплаты за вычетом возвратов по ним (по дате возврата)',
            }
        }

        const { join, freeze, personal, video } = await countClubRequests(ctx)
        // «Сообщения» over 30 days (read only — there is no send tool: sending
        // to people needs a person reading the preview). The list's rule:
        // a sport lead's token the whole club, others what the creator wrote.
        const sent = await prisma.clubMessage.aggregate({
            where: {
                workspaceId: scope.workspaceId,
                status: 'SENT',
                sentAt: { gte: since30 },
                ...(scope.isAdmin ? {} : { authorId: access.userId }),
            },
            _count: { _all: true },
            _sum: { recipientCount: true, readCount: true },
        })
        const recipients30d = sent._sum.recipientCount ?? 0
        const messages = {
            sent30d: sent._count._all,
            recipients30d,
            // Share of recipients who opened the message in the app (0–1).
            readShare:
                recipients30d > 0
                    ? Math.round(((sent._sum.readCount ?? 0) / recipients30d) * 100) / 100
                    : null,
        }

        return {
            rows: 1,
            data: {
                club: { name: access.workspaceName, timezone: tz, today: todayYmd },
                scope: scope.isAdmin
                    ? 'весь клуб'
                    : `направления: ${directions.map((d) => d.name).join(', ')}`,
                dataMode: ctx.people.personal ? 'с персональными данными' : 'обезличено',
                students: { total, active, new30d, withAbonement },
                groups,
                attendance: {
                    checkins7d,
                    checkins30d,
                    distinctAttendees30d: attendees30d.length,
                    sessions30d,
                },
                atRisk: summarizeRisk(risk),
                upcoming: { events7d, gradings },
                requests: { join, freeze, personal, video },
                messages,
                money,
            },
        }
    },
})
