// metric `students_active` («Активные ученики»): the figure the club pays
// ClubSpace by (docs/legal, landing FAQ) — a student who attended or opened the
// club in the app within the last 30 days. The bill, the platform console and
// the dashboard all count it here.
import type { Prisma, PrismaService } from '../../infrastructure/prisma'
import { DAY_MS } from '../subscriptions/freeze-dates'
import { type StudentScope, studentsIn, studentWhere } from './students'

const ACTIVE_STUDENT_WINDOW_DAYS = 30

// Served by the [workspaceId, status, lastAttendedAt|lastSeenAt] indexes.
const activeSince = (now: Date): Prisma.WorkspaceMemberWhereInput => {
    const since = new Date(now.getTime() - ACTIVE_STUDENT_WINDOW_DAYS * DAY_MS)
    return { OR: [{ lastAttendedAt: { gte: since } }, { lastSeenAt: { gte: since } }] }
}

export const countActiveStudents = (
    prisma: PrismaService,
    scope: StudentScope,
    now: Date,
): Promise<number> =>
    prisma.workspaceMember.count({ where: { AND: [studentsIn(scope), activeSince(now)] } })

// Many clubs in one grouped query (the bill, the platform console).
export const countActiveStudentsMany = async (
    prisma: PrismaService,
    workspaces: ReadonlyArray<{ id: string; ownerId: string }>,
    now: Date,
): Promise<Map<string, number>> => {
    const result = new Map<string, number>(workspaces.map((w) => [w.id, 0]))
    if (workspaces.length === 0) return result
    const rows = await prisma.workspaceMember.groupBy({
        by: ['workspaceId'],
        where: {
            AND: [
                { OR: workspaces.map((w) => studentWhere(w.id, w.ownerId)) },
                activeSince(now),
            ],
        },
        _count: { _all: true },
    })
    for (const row of rows) result.set(row.workspaceId, row._count._all)
    return result
}
