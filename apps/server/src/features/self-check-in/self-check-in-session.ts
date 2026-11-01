import { scopeCoversDirection } from '../../domains/subscriptions/current-subscriptions'
import { findFreezeOn } from '../../domains/subscriptions/services/subscription-freeze.service'
import type { LoadedVisitCandidate } from '../../domains/subscriptions/visit-abonement'
import { MemberStatus, PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    ForbiddenError,
} from '../../shared/errors/shared.errors'
import { formatRuDate } from '../../shared/utils/format-ru-date'
import { localDateInTz } from '../attendance/attendance-utils'
import {
    loadSessionVisitOptions,
    type SessionVisitOptions,
} from '../attendance/session-visits'

// A code only matches a session happening around now, so an old code can't be
// reused for an old session.
const CODE_WINDOW_MS = 12 * 60 * 60 * 1000

export type SelfCheckInSession = {
    session: {
        id: string
        title: string
        startAt: Date
        groupId: string | null
        occurrenceKey: string
    }
    visits: SessionVisitOptions
    // Every current abonement of the member / the eligible ones in precedence
    // order (first = the default).
    candidates: LoadedVisitCandidate[]
    ranked: LoadedVisitCandidate[]
}

// Everything check-in and its preview refuse on, in the same order, with no
// writes: the code, the membership, and a freeze that leaves nothing to pay
// with.
export const loadSelfCheckInSession = async (
    prisma: PrismaService,
    p: { workspaceId: string; userId: string; code: string; now: Date },
): Promise<SelfCheckInSession> => {
    const code = p.code.trim().toUpperCase()
    const session = await prisma.attendanceSession.findFirst({
        where: {
            workspaceId: p.workspaceId,
            isPersonal: false,
            checkInCode: code,
            startAt: {
                gte: new Date(p.now.getTime() - CODE_WINDOW_MS),
                lte: new Date(p.now.getTime() + CODE_WINDOW_MS),
            },
        },
        orderBy: { startAt: 'desc' },
        select: {
            id: true,
            title: true,
            startAt: true,
            groupId: true,
            occurrenceKey: true,
        },
    })
    if (!session) {
        throw new BadRequestError({
            message: 'Код не найден или занятие уже прошло',
        })
    }

    const membership = await prisma.workspaceMember.findFirst({
        where: { workspaceId: p.workspaceId, userId: p.userId },
        select: { status: true, workspace: { select: { timezone: true } } },
    })
    if (!membership || membership.status !== MemberStatus.ACTIVE) {
        throw new ForbiddenError({
            message: 'Только активные участники могут отмечаться',
        })
    }

    // The session's own day on the club calendar, matching the roster badge.
    const dayYmd = localDateInTz(session.startAt, membership.workspace.timezone)
    const visits = await loadSessionVisitOptions(prisma, {
        workspaceId: p.workspaceId,
        sessionId: session.id,
        dayYmd,
        userIds: [p.userId],
        now: p.now,
    })
    const candidates = visits.candidates.get(p.userId) ?? []
    const ranked = visits.ranked.get(p.userId) ?? []

    // A frozen abonement is paused, not used: when nothing else can pay for
    // this class, the member has to ask the club to end the freeze first.
    // Coach marking stays allowed (the member did attend), so this is the only
    // entry point that refuses. A frozen БЖЖ pack never blocks an ММА class,
    // and never while another (unfrozen) abonement covers the class.
    if (ranked.length === 0) {
        const frozen = candidates.find(
            (c) =>
                c.frozen &&
                scopeCoversDirection(c.directionIds, visits.sessionDirectionId),
        )
        const freeze = frozen
            ? await findFreezeOn(prisma, { subscriptionId: frozen.id, dayYmd })
            : null
        if (freeze) {
            throw new BadRequestError({
                message: `Абонемент заморожен по ${formatRuDate(freeze.untilDate, 'UTC')}. Чтобы отметиться, попросите тренера или администратора клуба снять заморозку.`,
            })
        }
    }

    return { session, visits, candidates, ranked }
}
