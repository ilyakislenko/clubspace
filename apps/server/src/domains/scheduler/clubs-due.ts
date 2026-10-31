import { localMinuteInTz } from '../../features/attendance/attendance-utils'
import type { PrismaService } from '../../infrastructure/prisma'

export type DueClub = {
    id: string
    name: string
    timezone: string
    ownerId: string
}

/** Club-local hour (0-23) of `now` in `tz`. */
export const localHourInTz = (now: Date, tz: string): number =>
    Number(localMinuteInTz(now, tz).slice(11, 13))

/**
 * Active clubs whose time zone passes `isDue`. Per-club daily work runs at
 * club-local time, so instead of walking every club on every run this reads
 * the handful of distinct time zones, keeps the ones that are due right now,
 * and loads only the clubs in them.
 */
export const findClubsDue = async (
    prisma: Pick<PrismaService, 'workspace'>,
    isDue: (tz: string) => boolean,
): Promise<DueClub[]> => {
    const zones = await prisma.workspace.findMany({
        where: { isActive: true },
        distinct: ['timezone'],
        select: { timezone: true },
    })
    const due = zones.map((z) => z.timezone).filter(isDue)
    if (due.length === 0) return []
    return prisma.workspace.findMany({
        where: { isActive: true, timezone: { in: due } },
        select: { id: true, name: true, timezone: true, ownerId: true },
    })
}
