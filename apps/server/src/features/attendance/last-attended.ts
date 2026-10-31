import { Logger } from '@nestjs/common'

import type { PrismaService } from '../../infrastructure/prisma'

const logger = new Logger('LastAttendedAt')

type RawClient = Pick<PrismaService, '$executeRaw'>

/**
 * Recomputes WorkspaceMember.lastAttendedAt = latest AttendanceRecord.markedAt
 * for these members of one club. A recompute rather than "= now" so one call
 * serves mark, self check-in and unmark alike, and is idempotent under races
 * (index [workspaceId, userId, markedAt] makes each max() a single probe).
 *
 * Runs after the attendance write committed and never throws: the mark has
 * already succeeded, and a stale value only shifts an inactivity nudge.
 */
export const syncLastAttendedAt = async (
    prisma: RawClient,
    workspaceId: string,
    userIds: string[],
): Promise<void> => {
    if (userIds.length === 0) return
    try {
        await prisma.$executeRaw`
            UPDATE "WorkspaceMember" wm
            SET "lastAttendedAt" = (
                SELECT max(ar."markedAt") FROM "AttendanceRecord" ar
                WHERE ar."workspaceId" = wm."workspaceId"
                  AND ar."userId" = wm."userId"
            )
            WHERE wm."workspaceId" = ${workspaceId}::uuid
              AND wm."userId" = ANY(${userIds}::uuid[])`
    } catch (err) {
        logger.warn(
            `lastAttendedAt sync failed for ${userIds.length} member(s) of ${workspaceId}: ${
                err instanceof Error ? err.message : String(err)
            }`,
        )
    }
}

/**
 * Fills lastAttendedAt for every membership from the attendance history. Run
 * once (the daily club job claims it in the dispatch log); afterwards the
 * attendance handlers keep the column current. Returns rows updated.
 */
export const backfillLastAttendedAt = async (
    prisma: RawClient,
): Promise<number> =>
    prisma.$executeRaw`
        UPDATE "WorkspaceMember" wm
        SET "lastAttendedAt" = a.last
        FROM (
            SELECT "workspaceId", "userId", max("markedAt") AS last
            FROM "AttendanceRecord"
            GROUP BY "workspaceId", "userId"
        ) a
        WHERE a."workspaceId" = wm."workspaceId"
          AND a."userId" = wm."userId"
          AND wm."lastAttendedAt" IS DISTINCT FROM a.last`
