import { z } from 'zod'

import { ymdToDbDate } from '../../../domains/subscriptions/freeze-dates'
import { capResult, defineTool, McpToolError, pageInput, paginate } from '../mcp-tool'
import {
    assertDirectionArg,
    dateArg,
    iso,
    resolveDateRange,
    scopedStudentIds,
    uuidArg,
} from './tool-helpers'

const CANDIDATES_CAP = 50

export const rankDistributionTool = defineTool({
    name: 'rank_distribution',
    title: 'Ранги учеников',
    description:
        'Распределение учеников по ступеням лестниц рангов (пояса, кю/даны, уровни): сколько учеников на каждой ступени. ' +
        'Текущий ранг — последнее повышение на лестнице. С levelId — постраничный список учеников этой ступени (полоски, с какой даты).',
    input: z.object({
        ladderId: uuidArg('Только эта лестница (id из club_directory)').optional(),
        directionId: uuidArg('Только лестницы этого направления').optional(),
        levelId: uuidArg('Показать учеников на этой ступени').optional(),
        ...pageInput,
    }),
    run: async (ctx, args) => {
        const { prisma, scope, people } = ctx
        await assertDirectionArg(ctx, args.directionId)
        const ladders = await prisma.rankLadder.findMany({
            where: {
                AND: [
                    scope.ladders(),
                    { isActive: true },
                    args.ladderId ? { id: args.ladderId } : {},
                    args.directionId ? { directionId: args.directionId } : {},
                ],
            },
            orderBy: { order: 'asc' },
            select: {
                id: true,
                name: true,
                direction: { select: { name: true } },
                levels: {
                    orderBy: { order: 'asc' },
                    select: { id: true, name: true, order: true, isActive: true },
                },
            },
        })
        if (args.ladderId && ladders.length === 0) {
            throw new McpToolError('Лестница не найдена или недоступна этому токену')
        }
        if (args.levelId && !ladders.some((l) => l.levels.some((v) => v.id === args.levelId))) {
            throw new McpToolError('Ступень не найдена в доступных лестницах')
        }
        const students = new Set(await scopedStudentIds(ctx))
        const promotions = await prisma.rankPromotion.findMany({
            where: { workspaceId: scope.workspaceId, ladderId: { in: ladders.map((l) => l.id) } },
            orderBy: [{ awardedAt: 'desc' }, { id: 'desc' }],
            select: { userId: true, ladderId: true, levelId: true, stripes: true, awardedAt: true },
        })
        // Current rank = the newest promotion per (member, ladder).
        const current = new Map<string, (typeof promotions)[number]>()
        for (const p of promotions) {
            if (!students.has(p.userId)) continue
            const key = `${p.ladderId}:${p.userId}`
            if (!current.has(key)) current.set(key, p)
        }
        const countByLevel = new Map<string, number>()
        for (const p of current.values()) {
            countByLevel.set(p.levelId, (countByLevel.get(p.levelId) ?? 0) + 1)
        }

        let members: Record<string, unknown> | null = null
        if (args.levelId) {
            const atLevel = [...current.values()]
                .filter((p) => p.levelId === args.levelId)
                .sort((a, b) => b.stripes - a.stripes || a.awardedAt.getTime() - b.awardedAt.getTime())
            const page = paginate(atLevel, args.offset, args.limit)
            const users = await prisma.user.findMany({
                where: { id: { in: page.items.map((p) => p.userId) } },
                select: { id: true, firstname: true, lastname: true, email: true, phone: true },
            })
            const byId = new Map(users.map((u) => [u.id, u]))
            members = {
                total: page.total,
                nextOffset: page.nextOffset,
                items: page.items.map((p) => {
                    const u = byId.get(p.userId)
                    return {
                        member: u ? people.member(u) : { ref: people.memberRef(p.userId) },
                        stripes: p.stripes,
                        since: iso(p.awardedAt),
                    }
                }),
            }
        }

        const result = ladders.map((l) => {
            const levels = l.levels.map((v) => ({
                id: v.id,
                name: v.name,
                order: v.order,
                archived: !v.isActive,
                members: countByLevel.get(v.id) ?? 0,
            }))
            return {
                id: l.id,
                name: l.name,
                direction: l.direction?.name ?? null,
                ranked: levels.reduce((s, v) => s + v.members, 0),
                levels,
            }
        })
        return {
            rows: result.length,
            data: capResult({
                studentsInScope: students.size,
                ladders: result,
                ...(members ? { levelMembers: members } : {}),
            }),
        }
    },
})

export const upcomingGradingsTool = defineTool({
    name: 'upcoming_gradings',
    title: 'Аттестации',
    description:
        'Аттестации (экзамены на следующий ранг) за период — по умолчанию ближайшие 90 дней: дата, лестница, зал, взнос, ' +
        'кандидаты (на какую ступень, откуда, результат PENDING/PASSED/FAILED, оплачен ли взнос). Для прошлых аттестаций задайте from.',
    input: z.object({
        from: dateArg('Первый день, ГГГГ-ММ-ДД (по умолчанию сегодня)').optional(),
        to: dateArg('Последний день включительно, ГГГГ-ММ-ДД').optional(),
        ladderId: uuidArg('Только эта лестница').optional(),
        directionId: uuidArg('Только лестницы этого направления').optional(),
        includeCandidates: z.boolean().default(true).describe('Включить список кандидатов (до 50 на аттестацию)'),
    }),
    run: async (ctx, args) => {
        const { prisma, scope, people } = ctx
        await assertDirectionArg(ctx, args.directionId)
        const range = resolveDateRange(ctx, {
            from: args.from,
            to: args.to,
            defaultDaysBack: 0,
            defaultDaysAhead: 90,
            maxDays: 366,
        })
        const gradings = await prisma.rankGrading.findMany({
            where: {
                workspaceId: scope.workspaceId,
                ladder: {
                    AND: [
                        scope.ladders(),
                        args.directionId ? { directionId: args.directionId } : {},
                    ],
                },
                ...(args.ladderId ? { ladderId: args.ladderId } : {}),
                date: { gte: ymdToDbDate(range.from), lte: ymdToDbDate(range.to) },
            },
            orderBy: { date: 'asc' },
            take: 50,
            select: {
                id: true,
                title: true,
                date: true,
                feeAmount: true,
                feeCurrency: true,
                gym: { select: { name: true } },
                ladder: { select: { name: true, direction: { select: { name: true } } } },
                candidates: {
                    orderBy: { createdAt: 'asc' },
                    select: {
                        stripes: true,
                        fromLevelName: true,
                        fromStripes: true,
                        result: true,
                        paidAt: true,
                        level: { select: { name: true } },
                        user: {
                            select: { id: true, firstname: true, lastname: true, email: true, phone: true },
                        },
                    },
                },
            },
        })
        const items = gradings.map((g) => {
            const byResult = { PENDING: 0, PASSED: 0, FAILED: 0 }
            for (const c of g.candidates) byResult[c.result] += 1
            return {
                id: g.id,
                title: g.title,
                date: g.date.toISOString().slice(0, 10),
                ladder: g.ladder.name,
                direction: g.ladder.direction?.name ?? null,
                gym: g.gym?.name ?? null,
                fee: g.feeAmount !== null ? { amount: g.feeAmount, currency: g.feeCurrency } : null,
                candidates: {
                    total: g.candidates.length,
                    byResult,
                    feePaid: g.candidates.filter((c) => c.paidAt !== null).length,
                    ...(args.includeCandidates
                        ? {
                              list: g.candidates.slice(0, CANDIDATES_CAP).map((c) => ({
                                  member: people.member(c.user),
                                  target: c.level.name,
                                  stripes: c.stripes,
                                  from: c.fromLevelName,
                                  fromStripes: c.fromStripes,
                                  result: c.result,
                                  feePaid: c.paidAt !== null,
                              })),
                          }
                        : {}),
                },
            }
        })
        return {
            rows: items.length,
            data: capResult({ period: range, total: items.length, items }),
        }
    },
})
