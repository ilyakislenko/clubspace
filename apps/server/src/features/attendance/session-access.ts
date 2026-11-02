import { PrismaService } from '../../infrastructure/prisma'
import {
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { CoachContext, RbacService } from '../../shared/services/rbac.service'

export type LoadedSession = {
    id: string
    workspaceId: string
    groupId: string | null
    slotId: string | null
    occurrenceKey: string
    workspaceEventId: string | null
    checkInCode: string | null
    coachId: string | null
    // An event session's teacher is whoever leads the event now — not the
    // `coachId` copied when the session was opened (the event's coach may have
    // changed since); null when it is not an event session or the event is gone.
    eventCoachId: string | null
    isPersonal: boolean
    startAt: Date
    timezone: string
}

const load = async (
    prisma: PrismaService,
    workspaceId: string,
    sessionId: string,
): Promise<LoadedSession> => {
    const s = await prisma.attendanceSession.findFirst({
        where: { id: sessionId, workspaceId },
        select: {
            id: true,
            workspaceId: true,
            groupId: true,
            slotId: true,
            occurrenceKey: true,
            workspaceEventId: true,
            checkInCode: true,
            coachId: true,
            isPersonal: true,
            startAt: true,
            timezone: true,
            workspaceEvent: { select: { coachId: true } },
        },
    })
    if (!s) throw new NotFoundError({ message: 'Занятие не найдено' })
    const { workspaceEvent, ...session } = s
    return { ...session, eventCoachId: workspaceEvent?.coachId ?? null }
}

// Write access: admin scope for anything; a group session for whoever may
// mark that class (`mark`: its group's coaches, the direction's manager, the
// approved substitute, any coach when the club allows it) or only for whoever
// runs the group (`manage`, e.g. deleting the session); event sessions
// require admin scope or leading the event now (its teacher marks who came).
export const loadSessionForWrite = async (
    prisma: PrismaService,
    rbac: RbacService,
    ctx: CoachContext,
    workspaceId: string,
    sessionId: string,
    access: 'mark' | 'manage' = 'mark',
): Promise<LoadedSession> => {
    const s = await load(prisma, workspaceId, sessionId)
    if (s.isPersonal) {
        if (rbac.canWriteAllGroups(ctx) || s.coachId === ctx.userId) return s
        throw new NotFoundError({ message: 'Занятие не найдено' })
    }
    if (s.groupId) {
        if (access === 'mark') {
            // Only slot occurrences have substitutes; an ad-hoc class has none.
            await rbac.assertCanMarkClass(
                ctx,
                s.groupId,
                s.slotId ? s.occurrenceKey : null,
            )
        } else {
            await rbac.assertCanWriteGroup(ctx, s.groupId)
        }
    } else if (
        !rbac.canWriteAllGroups(ctx) &&
        !(access === 'mark' && s.eventCoachId === ctx.userId)
    ) {
        throw new ForbiddenError({
            message:
                access === 'manage'
                    ? 'Это действие с событием доступно только администратору клуба'
                    : 'Менять посещения на событии может администратор клуба или педагог события',
        })
    }
    return s
}

// Read access: see-all scopes read anything; otherwise a coach reads a group
// session of a class they may mark, or the event they lead now.
export const loadSessionForRead = async (
    prisma: PrismaService,
    rbac: RbacService,
    ctx: CoachContext,
    workspaceId: string,
    sessionId: string,
): Promise<LoadedSession> => {
    const s = await load(prisma, workspaceId, sessionId)
    if (s.isPersonal) {
        if (rbac.canWriteAllGroups(ctx) || s.coachId === ctx.userId) return s
        throw new NotFoundError({ message: 'Занятие не найдено' })
    }
    if (rbac.canSeeAllGroups(ctx)) return s
    if (s.groupId) {
        await rbac.assertCanMarkClass(
            ctx,
            s.groupId,
            s.slotId ? s.occurrenceKey : null,
        )
        return s
    }
    if (s.eventCoachId === ctx.userId) return s
    throw new ForbiddenError({
        message: 'Нет доступа к этому занятию',
    })
}
