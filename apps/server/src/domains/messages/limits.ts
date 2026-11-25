// Sending limits per club-local day (docs/design/2026-11-26-broadcast-and-direct-messages.md
// §4.1): the club's broadcasts, a coach's or direction manager's own, direct
// messages and «Срочно» per sender; per recipient, broadcast pushes.
import type { PrismaService, PrismaTransactionClientType } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { formatRuDate } from '../../shared/utils/format-ru-date'
import { pluralRu } from '../../shared/utils/plural-ru'
import { clubDayStart } from '../subscriptions/first-visit-start'

const HOUR_MS = 3_600_000

export const CLUB_BROADCASTS_PER_DAY = 10
export const COACH_BROADCASTS_PER_DAY = 3
export const DIRECT_PER_SENDER_PER_DAY = 50
export const URGENT_PER_SENDER_PER_DAY = 2
// Past this many non-service broadcast pushes in a day a recipient still gets
// the in-app copy, without the push (pushSkip 'cap').
export const BROADCAST_PUSHES_PER_RECIPIENT_PER_DAY = 3

export type DayCounts = {
    // Non-direct messages of the club going out that day.
    clubBroadcasts: number
    // The sender's own that day.
    senderBroadcasts: number
    senderDirect: number
    senderUrgent: number
    // «28 ноября» for a later day; null = today (the refusal says «Сегодня»).
    dayLabel: string | null
}

export type LimitsLeft = {
    clubLeft: number
    // null = no personal broadcast limit (sport leads).
    senderLeft: number | null
    directLeft: number
    urgentLeft: number
}

export const limitsLeft = (counts: DayCounts, senderIsLead: boolean): LimitsLeft => ({
    clubLeft: Math.max(0, CLUB_BROADCASTS_PER_DAY - counts.clubBroadcasts),
    senderLeft: senderIsLead
        ? null
        : Math.max(0, COACH_BROADCASTS_PER_DAY - counts.senderBroadcasts),
    directLeft: Math.max(0, DIRECT_PER_SENDER_PER_DAY - counts.senderDirect),
    urgentLeft: Math.max(0, URGENT_PER_SENDER_PER_DAY - counts.senderUrgent),
})

// The refusal naming the limit a new message would break, else null.
export const limitRefusal = (
    counts: DayCounts,
    m: { isDirect: boolean; urgent: boolean; senderIsLead: boolean },
): string | null => {
    const left = limitsLeft(counts, m.senderIsLead)
    const day = counts.dayLabel
    const urgentN = `${URGENT_PER_SENDER_PER_DAY} ${pluralRu(URGENT_PER_SENDER_PER_DAY, 'срочное сообщение', 'срочных сообщения', 'срочных сообщений')}`
    const directN = `${DIRECT_PER_SENDER_PER_DAY} ${pluralRu(DIRECT_PER_SENDER_PER_DAY, 'личное сообщение', 'личных сообщения', 'личных сообщений')}`
    const clubN = `${CLUB_BROADCASTS_PER_DAY} ${pluralRu(CLUB_BROADCASTS_PER_DAY, 'рассылку', 'рассылки', 'рассылок')}`
    const coachN = `${COACH_BROADCASTS_PER_DAY} ${pluralRu(COACH_BROADCASTS_PER_DAY, 'рассылку', 'рассылки', 'рассылок')}`
    if (m.urgent && left.urgentLeft === 0) {
        return `Сегодня вы уже отправили ${urgentN} — следующее завтра`
    }
    if (m.isDirect) {
        if (left.directLeft > 0) return null
        return day
            ? `На ${day} у вас уже ${directN} — выберите другой день`
            : `Сегодня вы уже отправили ${directN} — следующее завтра`
    }
    if (left.clubLeft === 0) {
        return day
            ? `На ${day} у клуба уже ${clubN} — выберите другой день`
            : `Сегодня клуб уже отправил ${clubN} — следующая завтра`
    }
    if (left.senderLeft === 0) {
        return day
            ? `На ${day} у вас уже ${coachN} — выберите другой день`
            : `Сегодня вы уже отправили ${coachN} — следующая завтра`
    }
    return null
}

// The club's messages going out on the club-local day of `sendAt` (cancelled
// ones don't count): a message scheduled for Friday counts against Friday, so
// ten broadcasts can't be queued for one day from several. One query,
// counted in memory. Run it under the club's advisory lock with the insert.
export const loadDayCounts = async (
    prisma: Pick<PrismaService, 'clubMessage'>,
    p: { workspaceId: string; senderId: string; sendAt: Date; now: Date; timezone: string },
): Promise<DayCounts> => {
    const dayStart = clubDayStart(p.sendAt, p.timezone)
    // A local day lasts 23–25 h: 26 h past its start is always the next day.
    const dayEnd = clubDayStart(new Date(dayStart.getTime() + 26 * HOUR_MS), p.timezone)
    const rows = await prisma.clubMessage.findMany({
        where: {
            workspaceId: p.workspaceId,
            sendAt: { gte: dayStart, lt: dayEnd },
            status: { not: 'CANCELLED' },
        },
        select: { authorId: true, isDirect: true, urgent: true },
    })
    const counts: DayCounts = {
        clubBroadcasts: 0,
        senderBroadcasts: 0,
        senderDirect: 0,
        senderUrgent: 0,
        dayLabel:
            dayStart.getTime() === clubDayStart(p.now, p.timezone).getTime()
                ? null
                : formatRuDate(p.sendAt, p.timezone),
    }
    for (const r of rows) {
        const own = r.authorId === p.senderId
        if (!r.isDirect) counts.clubBroadcasts += 1
        if (own && !r.isDirect) counts.senderBroadcasts += 1
        if (own && r.isDirect) counts.senderDirect += 1
        if (own && r.urgent) counts.senderUrgent += 1
    }
    return counts
}

export const assertWithinLimits = (
    counts: DayCounts,
    m: { isDirect: boolean; urgent: boolean; senderIsLead: boolean },
): void => {
    const refusal = limitRefusal(counts, m)
    if (refusal) throw new BadRequestError({ message: refusal })
}

// Serialises the club's message writes for the rest of the transaction: the
// day counts and the insert (send), the per-recipient push cap and the
// recipient rows (delivery). Two requests can't both pass a limit on the same
// count. Released at commit.
export const lockClubMessages = (
    tx: Pick<PrismaTransactionClientType, '$executeRaw'>,
    workspaceId: string,
): Promise<number> =>
    tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`club-messages:${workspaceId}`}))`

// Recipients who already got the day's broadcast pushes from this club.
export const loadCappedRecipients = async (
    prisma: Pick<PrismaService, 'clubMessageRecipient'>,
    p: { workspaceId: string; userIds: string[]; now: Date; timezone: string },
): Promise<Set<string>> => {
    if (p.userIds.length === 0) return new Set()
    const rows = await prisma.clubMessageRecipient.groupBy({
        by: ['userId'],
        where: {
            workspaceId: p.workspaceId,
            userId: { in: p.userIds },
            pushSkip: null,
            createdAt: { gte: clubDayStart(p.now, p.timezone) },
            message: { isService: false, isDirect: false },
        },
        _count: { _all: true },
    })
    return new Set(
        rows
            .filter((r) => r._count._all >= BROADCAST_PUSHES_PER_RECIPIENT_PER_DAY)
            .map((r) => r.userId),
    )
}
