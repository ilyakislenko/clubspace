import { z } from 'zod'

import { sessionInDirectionWhere } from '../../../domains/directions/direction-scope'
import { addDaysYmd } from '../../../domains/subscriptions/freeze-dates'
import type { Prisma } from '../../../infrastructure/prisma'
import { localMinuteInTz, wallClockToUtc } from '../../attendance/attendance-utils'
import { GetWorkspaceScheduleFeature } from '../../get-workspace-schedule/get-workspace-schedule.feature'
import { aggregateAttendance } from '../mcp-aggregates'
import { capResult, defineTool, McpToolContext } from '../mcp-tool'
import {
    assertDirectionArg,
    assertGroupArg,
    assertGymArg,
    dateArg,
    resolveDateRange,
    uuidArg,
} from './tool-helpers'

const MAX_SESSIONS = 20_000

// "2026-11-02 19:00" in the zone the class lives in.
const localTime = (instant: Date | string, tz: string): string =>
    localMinuteInTz(new Date(instant), tz).replace('T', ' ')

// [start of `from`, start of the day after `to`) in the club's zone.
const utcWindow = (ctx: McpToolContext, from: string, to: string) => ({
    gte: wallClockToUtc(`${from}T00:00:00`, ctx.access.timezone),
    lt: wallClockToUtc(`${addDaysYmd(to, 1)}T00:00:00`, ctx.access.timezone),
})

export const scheduleTool = defineTool({
    name: 'schedule',
    title: 'Расписание',
    description:
        'Расписание занятий и событий клуба на период (по умолчанию 7 дней с сегодняшнего, максимум 31 день): ' +
        'дата и время по местному времени зала, группа, зал, направление, тренер, отмены с причиной, сколько гостей записалось из других групп. ' +
        'Фильтры: направление, зал, группа (id из club_directory).',
    input: z.object({
        from: dateArg('Первый день, ГГГГ-ММ-ДД (по умолчанию сегодня)').optional(),
        to: dateArg('Последний день включительно, ГГГГ-ММ-ДД').optional(),
        directionId: uuidArg('Только это направление').optional(),
        gymId: uuidArg('Только этот зал').optional(),
        groupId: uuidArg('Только эта группа').optional(),
    }),
    run: async (ctx, args) => {
        const { scope, people, access } = ctx
        await assertDirectionArg(ctx, args.directionId)
        await assertGymArg(ctx, args.gymId)
        await assertGroupArg(ctx, args.groupId)
        const range = resolveDateRange(ctx, {
            from: args.from,
            to: args.to,
            defaultDaysBack: 0,
            defaultDaysAhead: 6,
            maxDays: 31,
        })
        const res = await ctx.schedule.execute(
            new GetWorkspaceScheduleFeature(
                { from: range.from, to: range.to, directionId: args.directionId },
                access.workspaceId,
            ),
        )
        const sessions = res.sessions
            .filter(
                (s) =>
                    scope.allowsDirection(s.group.direction?.id ?? null) &&
                    (!args.gymId || s.group.gym?.id === args.gymId) &&
                    (!args.groupId || s.groupId === args.groupId),
            )
            .map((s) => ({
                start: localTime(s.startAt, s.timezone),
                end: localTime(s.endAt, s.timezone),
                timezone: s.timezone,
                group: { id: s.group.id, name: s.group.name },
                gym: s.group.gym?.name ?? null,
                direction: s.group.direction?.name ?? null,
                coach: people.staff(s.group.coach),
                cancelled: s.cancelled,
                cancellationReason: s.cancellationReason,
                bookedGuests: s.bookedGuests,
            }))
        const events = res.events
            .filter(
                (e) =>
                    scope.allowsDirection(e.direction?.id ?? null) &&
                    (!args.gymId || e.gym?.id === args.gymId) &&
                    !args.groupId,
            )
            .map((e) => ({
                id: e.id,
                title: e.title,
                start: localTime(e.startAt, e.timezone),
                end: localTime(e.endAt, e.timezone),
                timezone: e.timezone,
                gym: e.gym?.name ?? null,
                direction: e.direction?.name ?? null,
            }))
        return {
            rows: sessions.length + events.length,
            data: capResult({
                period: range,
                events,
                total: sessions.length,
                items: sessions,
            }),
        }
    },
})

export const attendanceStatsTool = defineTool({
    name: 'attendance_stats',
    title: 'Посещаемость',
    description:
        'Статистика посещаемости за период (по умолчанию последние 30 дней, максимум 366): занятия, отметки, уникальные ученики, ' +
        'среднее на занятие, гостевые визиты; разбивка по группам, дням недели и неделям; топ-10 самых посещающих учеников. ' +
        'Фильтры: группа, направление, зал.',
    input: z.object({
        from: dateArg('Первый день, ГГГГ-ММ-ДД').optional(),
        to: dateArg('Последний день включительно, ГГГГ-ММ-ДД (по умолчанию сегодня)').optional(),
        groupId: uuidArg('Только эта группа').optional(),
        directionId: uuidArg('Только это направление').optional(),
        gymId: uuidArg('Только группы этого зала').optional(),
    }),
    run: async (ctx, args) => {
        const { prisma, scope, people, access } = ctx
        await assertDirectionArg(ctx, args.directionId)
        await assertGroupArg(ctx, args.groupId)
        await assertGymArg(ctx, args.gymId)
        const range = resolveDateRange(ctx, {
            from: args.from,
            to: args.to,
            defaultDaysBack: 29,
            defaultDaysAhead: 0,
            maxDays: 366,
        })
        const sessionWhere: Prisma.AttendanceSessionWhereInput = {
            AND: [
                scope.sessions(),
                { startAt: utcWindow(ctx, range.from, range.to) },
                args.groupId ? { groupId: args.groupId } : {},
                args.directionId ? sessionInDirectionWhere(args.directionId) : {},
                args.gymId ? { group: { gymId: args.gymId } } : {},
            ],
        }
        const [sessions, records] = await Promise.all([
            prisma.attendanceSession.findMany({
                where: sessionWhere,
                take: MAX_SESSIONS,
                select: {
                    id: true,
                    startAt: true,
                    groupId: true,
                    isPersonal: true,
                    group: { select: { name: true } },
                },
            }),
            prisma.attendanceRecord.findMany({
                where: { workspaceId: scope.workspaceId, session: sessionWhere },
                select: { sessionId: true, userId: true, isGuest: true },
            }),
        ])
        const agg = aggregateAttendance(
            sessions.map((s) => ({
                id: s.id,
                startAt: s.startAt,
                groupId: s.groupId,
                groupName: s.group?.name ?? null,
                isPersonal: s.isPersonal,
            })),
            records,
            access.timezone,
        )
        const topUsers = await prisma.user.findMany({
            where: { id: { in: agg.topAttendees.map((t) => t.userId) } },
            select: { id: true, firstname: true, lastname: true, email: true, phone: true },
        })
        const userById = new Map(topUsers.map((u) => [u.id, u]))
        return {
            rows: sessions.length,
            data: capResult({
                period: range,
                ...agg.totals,
                byGroup: agg.byGroup,
                byWeekday: agg.byWeekday,
                byWeek: agg.byWeek,
                topAttendees: agg.topAttendees.map((t) => {
                    const user = userById.get(t.userId)
                    return {
                        member: user ? people.member(user) : { ref: people.memberRef(t.userId) },
                        visits: t.visits,
                    }
                }),
            }),
        }
    },
})

export const listEventsTool = defineTool({
    name: 'list_events',
    title: 'События',
    description:
        'События клуба (семинары, открытые ковры, соревнования) за период — по умолчанию ближайшие 60 дней, максимум 366: ' +
        'название, время по местному времени события, зал, направление, тренер, сколько человек отметилось на прошедших.',
    input: z.object({
        from: dateArg('Первый день, ГГГГ-ММ-ДД (по умолчанию сегодня)').optional(),
        to: dateArg('Последний день включительно, ГГГГ-ММ-ДД').optional(),
        directionId: uuidArg('Только это направление').optional(),
    }),
    run: async (ctx, args) => {
        const { prisma, scope, people } = ctx
        await assertDirectionArg(ctx, args.directionId)
        const range = resolveDateRange(ctx, {
            from: args.from,
            to: args.to,
            defaultDaysBack: 0,
            defaultDaysAhead: 60,
            maxDays: 366,
        })
        const events = await prisma.workspaceEvent.findMany({
            where: {
                AND: [
                    scope.events(),
                    { startAt: utcWindow(ctx, range.from, range.to) },
                    args.directionId ? { directionId: args.directionId } : {},
                ],
            },
            orderBy: { startAt: 'asc' },
            take: 200,
            select: {
                id: true,
                title: true,
                description: true,
                startAt: true,
                endAt: true,
                timezone: true,
                gym: { select: { name: true } },
                direction: { select: { name: true } },
                coach: { select: { id: true, firstname: true, lastname: true } },
                attendanceSessions: { select: { _count: { select: { records: true } } } },
            },
        })
        const items = events.map((e) => ({
            id: e.id,
            title: e.title,
            description: e.description ? e.description.slice(0, 500) : null,
            start: localTime(e.startAt, e.timezone),
            end: localTime(e.endAt, e.timezone),
            timezone: e.timezone,
            gym: e.gym?.name ?? null,
            direction: e.direction?.name ?? null,
            coach: e.coach ? people.staff(e.coach) : null,
            checkedIn: e.attendanceSessions.reduce((s, x) => s + x._count.records, 0),
        }))
        return {
            rows: items.length,
            data: capResult({ period: range, total: items.length, items }),
        }
    },
})
