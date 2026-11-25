import { assertDirectionInWorkspace } from '../../domains/directions/direction-scope'
import { nextSendAt } from '../../domains/notifications/quiet-hours'
import {
    type MessageScope,
    type SegmentTarget,
    segmentMemberWhere,
} from '../../domains/messages/segment-where'
import { DAY_MS } from '../../domains/subscriptions/freeze-dates'
import type { PrismaService } from '../../infrastructure/prisma'
import { assertSportLead } from '../../shared/access/assert-admin-scope'
import { BadRequestError, NotFoundError } from '../../shared/errors/shared.errors'
import { type CoachContext, RbacService } from '../../shared/services/rbac.service'
import { CLUB_MESSAGE_MAX_SCHEDULE_DAYS } from './schemas'

export type ComposePayload = {
    segment: SegmentTarget['segment']
    directionId?: string
    groupIds?: string[]
    memberIds?: string[]
    isService?: boolean
    urgent?: boolean
    withEmail?: boolean
    sendAt?: string
}

export type ComposeCaller = {
    workspaceId: string
    invokerUserId: string
    roleName: string | null
    isSuperAdmin: boolean
}

export type Compose = {
    ctx: CoachContext
    isLead: boolean
    scope: MessageScope
    workspace: {
        id: string
        name: string
        ownerId: string
        timezone: string
        messagesEmailEnabled: boolean
    }
    target: SegmentTarget
    isDirect: boolean
    isService: boolean
    urgent: boolean
    withEmail: boolean
    // When it goes out: the requested time (not before now), moved to the end
    // of quiet hours unless urgent.
    sendAt: Date
    deferredByQuietHours: boolean
}

// Who may send what (docs/design/2026-11-26-broadcast-and-direct-messages.md §2):
// the route is COACHING_ROLES; «Продлить», «Не оплатили» and «служебное» are
// the sport-lead tier (renewals and receivables); groups must be the sender's
// own, a direction one they run; named students must be in the sender's
// scope (else 404, as if they didn't exist). Shared by preview and send.
export const prepareCompose = async (
    prisma: PrismaService,
    rbac: RbacService,
    f: ComposeCaller & { payload: ComposePayload },
    now: Date,
): Promise<Compose> => {
    const caller = {
        userId: f.invokerUserId,
        workspaceId: f.workspaceId,
        roleName: f.roleName,
        isSuperAdmin: f.isSuperAdmin,
    }
    const ctx = await rbac.resolveCoachScope(caller)
    const p = f.payload
    if (p.segment === 'RENEW' || p.segment === 'UNPAID') {
        await assertSportLead(
            rbac,
            caller,
            'Сегменты «Продлить» и «Не оплатили» доступны владельцу, администратору и главному тренеру',
        )
    }
    if (p.isService) {
        await assertSportLead(
            rbac,
            caller,
            'Служебные сообщения отправляют владелец, администратор и главный тренер',
        )
    }
    const isLead = rbac.canWriteAllGroups(ctx)

    const workspace = await prisma.workspace.findUniqueOrThrow({
        where: { id: f.workspaceId },
        select: { id: true, name: true, ownerId: true, timezone: true, messagesEmailEnabled: true },
    })
    const scope: MessageScope = { groupIds: isLead ? null : await rbac.ownGroupIds(ctx) }

    const target: SegmentTarget = {
        segment: p.segment,
        directionId: p.segment === 'DIRECTION' ? (p.directionId ?? null) : null,
        groupIds: p.segment === 'GROUPS' ? [...new Set(p.groupIds ?? [])] : [],
        memberIds: p.segment === 'MEMBERS' ? [...new Set(p.memberIds ?? [])] : [],
    }
    if (target.segment === 'GROUPS') {
        const found = await prisma.group.count({
            where: { id: { in: target.groupIds }, workspaceId: f.workspaceId },
        })
        if (found !== target.groupIds.length) {
            throw new NotFoundError({ message: 'Группа не найдена' })
        }
        if (!isLead) {
            for (const groupId of target.groupIds) await rbac.assertCanWriteGroup(ctx, groupId)
        }
    }
    if (target.segment === 'DIRECTION') {
        await assertDirectionInWorkspace(prisma, f.workspaceId, target.directionId)
        await rbac.assertCanManageDirection(ctx, target.directionId)
    }
    if (target.segment === 'MEMBERS') {
        const found = await prisma.workspaceMember.count({
            where: segmentMemberWhere({
                workspaceId: f.workspaceId,
                ownerId: workspace.ownerId,
                target,
                scope,
                now,
            }),
        })
        if (found !== target.memberIds.length) {
            throw new NotFoundError({ message: 'Ученик не найден' })
        }
    }

    const withEmail = p.withEmail ?? false
    if (withEmail && !workspace.messagesEmailEnabled) {
        throw new BadRequestError({ message: 'E-mail для сообщений выключен в настройках клуба' })
    }

    const requested = p.sendAt ? new Date(p.sendAt) : now
    if (requested.getTime() > now.getTime() + CLUB_MESSAGE_MAX_SCHEDULE_DAYS * DAY_MS) {
        throw new BadRequestError({
            message: `Отправить позже можно не дальше чем на ${CLUB_MESSAGE_MAX_SCHEDULE_DAYS} дней`,
        })
    }
    const urgent = p.urgent ?? false
    // «Срочно» means now: a scheduled urgent message would skip quiet hours at
    // any hour it was set for.
    if (urgent && requested > now) {
        throw new BadRequestError({
            message: 'Срочное сообщение уходит сразу — уберите «Отправить позже» или «Срочно»',
        })
    }
    const base = requested > now ? requested : now
    const sendAt = urgent ? base : nextSendAt(base, workspace.timezone)

    return {
        ctx,
        isLead,
        scope,
        workspace,
        target,
        isDirect: target.segment === 'MEMBERS' && target.memberIds.length === 1,
        isService: p.isService ?? false,
        urgent,
        withEmail,
        sendAt,
        deferredByQuietHours: sendAt.getTime() > base.getTime(),
    }
}
