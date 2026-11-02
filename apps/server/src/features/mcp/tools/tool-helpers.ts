// Argument checks shared by the tools: an id the assistant passes must belong
// to this club AND to the token's scope, or the tool refuses with a message the
// model can act on. Same wording for "doesn't exist" and "not yours", so a
// direction manager's token can't probe for other directions' ids.
import { z } from 'zod'

import { PSEUDONYM_RE } from '../../../domains/ai-assistant/pseudonym'
import { localDateInTz } from '../../attendance/attendance-utils'
import { McpToolContext, McpToolError } from '../mcp-tool'

const DAY_MS = 24 * 60 * 60 * 1000

export const uuidArg = (description: string) => z.string().uuid().describe(description)

export const dateArg = (description: string) => z.iso.date().describe(description)

export const assertDirectionArg = async (
    ctx: McpToolContext,
    directionId: string | undefined,
): Promise<void> => {
    if (!directionId) return
    const found = await ctx.prisma.direction.findFirst({
        where: { AND: [ctx.scope.directions(), { id: directionId }] },
        select: { id: true },
    })
    if (!found) {
        throw new McpToolError(
            'Направление не найдено или недоступно этому токену — возьмите id из club_directory',
        )
    }
}

export const assertGroupArg = async (
    ctx: McpToolContext,
    groupId: string | undefined,
): Promise<void> => {
    if (!groupId) return
    const found = await ctx.prisma.group.findFirst({
        where: { AND: [ctx.scope.groups(), { id: groupId }] },
        select: { id: true },
    })
    if (!found) {
        throw new McpToolError(
            'Группа не найдена или недоступна этому токену — возьмите id из club_directory',
        )
    }
}

export const assertGymArg = async (
    ctx: McpToolContext,
    gymId: string | undefined,
): Promise<void> => {
    if (!gymId) return
    const found = await ctx.prisma.gym.findFirst({
        where: { workspaceId: ctx.scope.workspaceId, id: gymId },
        select: { id: true },
    })
    if (!found) {
        throw new McpToolError('Зал не найден — возьмите id из club_directory')
    }
}

// Students in scope as user ids (direction managers: their groups' students).
export const scopedStudentIds = async (ctx: McpToolContext): Promise<string[]> =>
    (
        await ctx.prisma.workspaceMember.findMany({
            where: ctx.scope.students(),
            select: { userId: true },
        })
    ).map((m) => m.userId)

// A member reference from the assistant (the `ref` of an earlier answer) back
// to a user id, within scope. Pseudonyms can't be inverted, so the scoped
// students are hashed and matched.
export const resolveMemberRef = async (
    ctx: McpToolContext,
    ref: string,
): Promise<string> => {
    const value = ref.trim().toLowerCase()
    if (!PSEUDONYM_RE.test(value) || !value.startsWith('m_')) {
        throw new McpToolError(
            'Укажите участника его ref из ответа search_members (вида m_0123456789)',
        )
    }
    const userId = (await scopedStudentIds(ctx)).find(
        (id) => ctx.people.memberRef(id) === value,
    )
    if (!userId) {
        throw new McpToolError('Участник не найден или недоступен этому токену')
    }
    return userId
}

// A from/to window of club-local dates: defaults, order and maximum length.
export const resolveDateRange = (
    ctx: McpToolContext,
    p: { from?: string; to?: string; defaultDaysBack: number; defaultDaysAhead: number; maxDays: number },
): { from: string; to: string } => {
    const today = localDateInTz(ctx.now, ctx.access.timezone)
    const shift = (ymd: string, days: number) =>
        new Date(new Date(`${ymd}T00:00:00Z`).getTime() + days * DAY_MS)
            .toISOString()
            .slice(0, 10)
    const from = p.from ?? shift(today, -p.defaultDaysBack)
    // Default end: today + ahead; a `from` past that keeps the default length.
    let to = p.to ?? shift(today, p.defaultDaysAhead)
    if (p.to === undefined && to < from) {
        to = shift(from, Math.max(p.defaultDaysAhead, p.defaultDaysBack))
    }
    if (to < from) throw new McpToolError('Дата «to» раньше даты «from»')
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1
    if (days > p.maxDays) {
        throw new McpToolError(`Слишком длинный период: не больше ${p.maxDays} дней`)
    }
    return { from, to }
}

// The tag of a group / tariff (`ref` next to its name): the admin's AI chat
// shows it as the name linked to the group's or tariff's page, the way a
// member's m_… pseudonym becomes the name and the member card.
export const groupRef = (id: string): string => `[group:${id}]`
export const planRef = (id: string): string => `[plan:${id}]`

export const iso = (d: Date | null | undefined): string | null =>
    d ? d.toISOString() : null

// A calendar day of an abonement or access term (stored as the club's local
// midnight) as the admin shows it: ГГГГ-ММ-ДД in the club's zone. Its UTC
// date is the day before east of Greenwich — the model would read that.
export const clubDate = (ctx: McpToolContext, d: Date | string | null | undefined): string | null =>
    d ? localDateInTz(new Date(d), ctx.access.timezone) : null
