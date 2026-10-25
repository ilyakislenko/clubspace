import { PrismaService } from '../../infrastructure/prisma'

const CHUNK = 500

// Why markedAt (not the session date): a check-in is a fact at the moment the
// coach marks it, it is the column the [workspaceId, userId, markedAt] index
// covers, and it is comparable with the promotion's awardedAt instant.
// Attendance count per member since their own cut-off instant. One groupBy per
// 500 members; each OR branch is an index range on
// [workspaceId, userId, markedAt].
export const countVisitsSince = async (
    prisma: Pick<PrismaService, 'attendanceRecord'>,
    workspaceId: string,
    items: { userId: string; since: Date }[],
): Promise<Map<string, number>> => {
    const counts = new Map<string, number>()
    for (let i = 0; i < items.length; i += CHUNK) {
        const chunk = items.slice(i, i + CHUNK)
        const rows = await prisma.attendanceRecord.groupBy({
            by: ['userId'],
            where: {
                workspaceId,
                OR: chunk.map((c) => ({
                    userId: c.userId,
                    markedAt: { gte: c.since },
                })),
            },
            _count: { _all: true },
        })
        for (const r of rows) counts.set(r.userId, r._count._all)
    }
    return counts
}
