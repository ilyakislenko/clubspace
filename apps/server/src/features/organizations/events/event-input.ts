import {
    isValidIanaTz,
    localMinuteInTz,
    wallClockToUtc,
} from '../../../features/attendance/attendance-utils'
import { activeClubIds } from '../../../domains/organizations/org-access'
import { PrismaService } from '../../../infrastructure/prisma'
import { BadRequestError } from '../../../shared/errors/shared.errors'

export const assertValidTimezone = (tz: string): void => {
    if (!isValidIanaTz(tz)) {
        throw new BadRequestError({ message: 'Неизвестный часовой пояс' })
    }
}

// A wall clock in `tz`, or the stored instant re-read in the new zone when
// only the zone changed (the organiser keeps the time they typed).
export const resolveInstant = (
    wall: string | null | undefined,
    current: Date | null,
    currentTz: string,
    tz: string,
): Date | null | undefined => {
    if (wall === null) return null
    if (wall !== undefined) return wallClockToUtc(wall, tz)
    if (current && tz !== currentTz) {
        return wallClockToUtc(localMinuteInTz(current, currentTz), tz)
    }
    return undefined
}

export const assertEventTimes = (startAt: Date, endAt: Date | null): void => {
    if (endAt && endAt <= startAt) {
        throw new BadRequestError({ message: 'Начало должно быть раньше окончания' })
    }
}

// A host must be a club ACTIVE in the org.
export const assertHostClub = async (
    prisma: PrismaService,
    organizationId: string,
    hostClubId: string | null | undefined,
): Promise<void> => {
    if (!hostClubId) return
    const clubs = await activeClubIds(prisma, organizationId)
    if (!clubs.includes(hostClubId)) {
        throw new BadRequestError({ message: 'Клуб-хозяин должен состоять в федерации' })
    }
}
