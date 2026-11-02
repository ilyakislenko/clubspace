import { z } from 'zod'

import { loadWorkspaceRisk } from '../../../domains/retention/load-workspace-risk'
import { summarizeRisk } from '../../../domains/retention/risk-signals'
import { currentSubscriptionWhere } from '../../../domains/subscriptions/current-subscriptions'
import { ymdToDbDate } from '../../../domains/subscriptions/freeze-dates'
import { localDateInTz } from '../../attendance/attendance-utils'
import {
    awaitingPaymentWhere,
    dominantCurrency,
    paidInRangeWhere,
    paidOn,
    revenueTrendStart,
    summarizeAwaiting,
    ticketRevenueRow,
    ticketRevenueSelect,
    ticketsPaidInRangeWhere,
} from '../../get-workspace-stats/revenue'
import { defineTool } from '../mcp-tool'
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

export const clubOverviewTool = defineTool({
    name: 'club_overview',
    title: 'Сводка по клубу',
    description:
        'Главные цифры клуба на сейчас: ученики (всего, активные, новые за 30 дней), посещаемость за 7 и 30 дней, ' +
        'действующие абонементы, сколько учеников в зоне риска оттока, ближайшие события и аттестации. ' +
        'Для токена администратора — ещё выручка за 30 дней и текущий месяц и сумма неоплаченных абонементов. ' +
        'Хорошая отправная точка для вопросов «как дела в клубе».',
    input: z.object({}),
    run: async (ctx) => {
        const { prisma, scope, access, now } = ctx
        const tz = access.timezone
        const since7 = new Date(now.getTime() - 7 * DAY_MS)
        const since30 = new Date(now.getTime() - 30 * DAY_MS)
        const in7 = new Date(now.getTime() + 7 * DAY_MS)
        const todayYmd = localDateInTz(now, tz)
        const students = scope.students()
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
            currentAbonements,
            events7d,
            gradings,
        ] = await Promise.all([
            prisma.workspaceMember.count({ where: students }),
            prisma.workspaceMember.count({ where: { ...students, status: 'ACTIVE' } }),
            prisma.workspaceMember.count({ where: { ...students, createdAt: { gte: since30 } } }),
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
            prisma.subscription.count({
                where: { workspaceMember: students, ...currentSubscriptionWhere(now) },
            }),
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
        if (scope.isAdmin) {
            const monthStart = revenueTrendStart(now, tz, 1)
            const windowStart = monthStart < since30 ? monthStart : since30
            const [paidSubs, paidTickets, awaiting] = await Promise.all([
                prisma.subscription.findMany({
                    where: {
                        workspaceId: scope.workspaceId,
                        ...paidInRangeWhere({ gte: windowStart }),
                    },
                    select: { amountPaid: true, currency: true, paidAt: true, createdAt: true },
                }),
                // Event tickets marked paid: sales like on the dashboard.
                prisma.eventRegistration.findMany({
                    where: {
                        workspaceId: scope.workspaceId,
                        ...ticketsPaidInRangeWhere({ gte: windowStart }),
                    },
                    select: ticketRevenueSelect,
                }),
                prisma.subscription.findMany({
                    where: awaitingPaymentWhere(scope.workspaceId),
                    select: { amountPaid: true, currency: true },
                }),
            ])
            const paid = [...paidSubs, ...paidTickets.map(ticketRevenueRow)]
            const currency = dominantCurrency(paid) ?? dominantCurrency(awaiting)
            const sumSince = (from: Date) =>
                paid
                    .filter((r) => r.currency === currency && paidOn(r) >= from)
                    .reduce((s, r) => s + r.amountPaid, 0)
            money = {
                currency,
                revenue30d: sumSince(since30),
                revenueThisMonth: sumSince(monthStart),
                unpaid: summarizeAwaiting(awaiting, currency),
                note: 'Суммы в целых единицах валюты; выручка — оплаченные абонементы и билеты на события по дате оплаты',
            }
        }

        return {
            rows: 1,
            data: {
                club: { name: access.workspaceName, timezone: tz, today: todayYmd },
                scope: scope.isAdmin
                    ? 'весь клуб'
                    : `направления: ${directions.map((d) => d.name).join(', ')}`,
                dataMode: ctx.people.personal ? 'с персональными данными' : 'обезличено',
                members: { total, active, new30d },
                groups,
                attendance: {
                    checkins7d,
                    checkins30d,
                    distinctAttendees30d: attendees30d.length,
                    sessions30d,
                },
                abonements: { current: currentAbonements },
                atRisk: summarizeRisk(risk),
                upcoming: { events7d, gradings },
                money,
            },
        }
    },
})
