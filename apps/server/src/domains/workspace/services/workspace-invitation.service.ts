import { Injectable, Logger } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'

import { environment } from '../../../environments/environment'
import {
    SendNotificationFeature,
    SendNotificationFeatureResponse,
} from '../../../features/send-notification/send-notification.feature'
import {
    NotificationTypeEnum,
    PrismaService,
    PrismaTransactionClientType,
} from '../../../infrastructure/prisma'
import {
    BadRequestError,
    ConflictError,
    NotFoundError,
} from '../../../shared/errors/shared.errors'
import { escapeHtml } from '../../../shared/utils/escape-html'
import { PlatformBillingService } from '../../billing/services/platform-billing.service'
import { NotificationProducerService } from '../../notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../realtime/realtime-emitter.service'
import { appLinksHtml, buildAppLinks, buildJoinUrl } from '../invite-links'
import { formatJoinCode } from '../join-code'
import { ensureJoinCode } from '../join-code.store'

export type InvitedRole = 'user' | 'coach'

export type AcceptedInvitation = {
    workspaceId: string
    workspaceName: string
    roleName: InvitedRole
    // The group the person actually landed in (null: none, or it was deleted).
    groupId: string | null
}

const isP2002 = (e: unknown): boolean =>
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002'

// Puts a just-admitted member into the group they were invited to. A student
// joins the roster (and loses any guest booking there, the class is now their
// own); a coach becomes an assistant coach and leaves the student roster. A
// student who is the group's own primary coach is not added. Returns whether
// the person ended up in the group.
export const placeInGroup = async (
    tx: PrismaTransactionClientType,
    p: {
        group: { id: string; coachId: string | null }
        userId: string
        roleName: InvitedRole
    },
): Promise<boolean> => {
    const { group, userId } = p
    if (p.roleName === 'user') {
        if (group.coachId === userId) return false
        await tx.groupMember.upsert({
            where: { groupId_userId: { groupId: group.id, userId } },
            update: {},
            create: { groupId: group.id, userId },
        })
        await tx.dropInBooking.deleteMany({
            where: { groupId: group.id, userId },
        })
        return true
    }
    await tx.groupMember.deleteMany({ where: { groupId: group.id, userId } })
    await tx.groupCoach.upsert({
        where: { groupId_userId: { groupId: group.id, userId } },
        update: {},
        create: { groupId: group.id, userId, role: 'assistant' },
    })
    return true
}

// Membership offers to people who already have an account (security M8: a
// club must not enrol an existing person without their consent). The admin
// endpoints create the offer; the person accepts or declines it in the app.
@Injectable()
export class WorkspaceInvitationService {
    private readonly logger = new Logger(WorkspaceInvitationService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
        private readonly featuresBus: FeaturesBus,
        private readonly billing: PlatformBillingService,
    ) {}

    // Creates the offer, or refreshes the role/group of one already waiting
    // (a repeated invite is not a second push). Never fails on notification
    // delivery: the offer stands and emailSent reports what happened.
    async invite(p: {
        workspace: { id: string; name: string }
        user: { id: string; email: string }
        roleName: InvitedRole
        groupId: string | null
        invitedById: string
        sendEmail: boolean
    }): Promise<{ invitationId: string; emailSent: boolean }> {
        const data = {
            roleName: p.roleName,
            groupId: p.groupId,
            invitedById: p.invitedById,
        }
        let invitationId: string
        try {
            const created = await this.prisma.workspaceInvitation.create({
                data: { ...data, workspaceId: p.workspace.id, userId: p.user.id },
                select: { id: true },
            })
            invitationId = created.id
        } catch (error) {
            if (!isP2002(error)) throw error
            const updated = await this.prisma.workspaceInvitation.update({
                where: {
                    workspaceId_userId: {
                        workspaceId: p.workspace.id,
                        userId: p.user.id,
                    },
                },
                data,
                select: { id: true },
            })
            invitationId = updated.id
        }

        this.realtime.invalidate(p.workspace.id, ['members'])
        this.realtime.invalidateUsers([p.user.id], ['invitations'])

        try {
            await this.notifications.notifyUser({
                userId: p.user.id,
                kind: 'member.invitation',
                refId: invitationId,
                topic: `Приглашение в клуб «${p.workspace.name}»`,
                message: 'Откройте приложение, чтобы принять или отклонить приглашение.',
                metadata: { workspaceId: p.workspace.id, invitationId },
            })
        } catch (error) {
            this.warn('invitation inbox entry', error)
        }

        let emailSent = false
        if (p.sendEmail) {
            try {
                emailSent = await this.sendInviteEmail({
                    userId: p.user.id,
                    workspace: p.workspace,
                    email: p.user.email,
                    roleName: p.roleName,
                })
            } catch (error) {
                this.warn('invitation e-mail', error)
            }
        }
        return { invitationId, emailSent }
    }

    // The member-invite e-mail: the club's join code and link plus the store
    // buttons. Entering the code (or opening the link) accepts a waiting offer.
    async sendInviteEmail(p: {
        userId: string
        workspace: { id: string; name: string }
        email: string
        roleName: InvitedRole
    }): Promise<boolean> {
        const code = await ensureJoinCode(this.prisma, p.workspace.id)
        const joinUrl = buildJoinUrl(environment.appUrl, code)
        const result = await this.featuresBus.execute<
            SendNotificationFeature,
            SendNotificationFeatureResponse
        >(
            new SendNotificationFeature({
                userId: p.userId,
                topic: `Приглашение в клуб «${p.workspace.name}»`,
                message: {
                    htmlTemplateKey: 'member-invite',
                    data: {
                        workspaceName: escapeHtml(p.workspace.name),
                        roleLabel: p.roleName === 'coach' ? 'тренера' : 'ученика',
                        email: escapeHtml(p.email),
                        joinCodeDisplay: formatJoinCode(code),
                        // Pre-rendered: templates have no conditionals.
                        joinLinkHtml: joinUrl
                            ? ` или откройте ссылку <a href="${escapeHtml(joinUrl)}">${escapeHtml(joinUrl)}</a>`
                            : '',
                        appLinksHtml: appLinksHtml(
                            buildAppLinks({
                                appUrl: environment.appUrl ?? '',
                                appStoreUrl: environment.appStoreUrl,
                                playStoreUrl: environment.playStoreUrl,
                                ruStoreUrl: environment.ruStoreUrl,
                            }),
                        ),
                    },
                },
                types: [NotificationTypeEnum.EMAIL],
                forced: true,
                metadata: {
                    kind: 'member.invite',
                    workspaceId: p.workspace.id,
                },
            }),
        )
        return result.success
    }

    // Accepting makes the person an ACTIVE member with the offered role (a
    // turned-down or suspended row of theirs is reactivated) and places them in
    // the offered group if it still exists. The offer is consumed.
    async accept(p: {
        userId: string
        invitationId: string
    }): Promise<AcceptedInvitation> {
        const inv = await this.prisma.workspaceInvitation.findFirst({
            where: { id: p.invitationId, userId: p.userId },
            select: {
                id: true,
                roleName: true,
                groupId: true,
                workspace: {
                    select: { id: true, name: true, isActive: true, ownerId: true },
                },
            },
        })
        if (!inv) {
            throw new NotFoundError({ message: 'Приглашение не найдено' })
        }
        if (!inv.workspace.isActive) {
            throw new BadRequestError({ message: 'Клуб сейчас недоступен' })
        }
        const roleName: InvitedRole = inv.roleName === 'coach' ? 'coach' : 'user'
        const role = await this.prisma.role.findUnique({
            where: { name: roleName },
            select: { id: true },
        })
        if (!role) {
            throw new NotFoundError({
                message: `Роль «${roleName}» не найдена — платформа не до конца инициализирована`,
            })
        }
        const workspaceId = inv.workspace.id

        // Accepting takes a seat like approving a request does: refused with
        // PLAN_LIMIT_REACHED when the club's plan is full (the offer stays).
        if (inv.workspace.ownerId !== p.userId) {
            const current = await this.prisma.workspaceMember.findUnique({
                where: { userId_workspaceId: { userId: p.userId, workspaceId } },
                select: { status: true },
            })
            if (current?.status !== 'ACTIVE') {
                await this.billing.assertWithinLimit(
                    workspaceId,
                    roleName === 'user' ? 'members' : 'coaches',
                )
            }
        }

        let placedGroupId: string | null = null
        try {
            await this.prisma.$transaction(async (tx) => {
                // The owner has no WorkspaceMember row and needs none.
                if (inv.workspace.ownerId !== p.userId) {
                    const existing = await tx.workspaceMember.findUnique({
                        where: {
                            userId_workspaceId: { userId: p.userId, workspaceId },
                        },
                        select: { id: true, status: true },
                    })
                    if (!existing) {
                        await tx.workspaceMember.create({
                            data: {
                                status: 'ACTIVE',
                                workspaceId,
                                userId: p.userId,
                                roleId: role.id,
                            },
                        })
                    } else if (existing.status !== 'ACTIVE') {
                        await tx.workspaceMember.update({
                            where: { id: existing.id },
                            data: { status: 'ACTIVE', roleId: role.id },
                        })
                    }
                }
                if (inv.groupId) {
                    const group = await tx.group.findFirst({
                        where: { id: inv.groupId, workspaceId },
                        select: { id: true, coachId: true },
                    })
                    if (
                        group &&
                        (await placeInGroup(tx, { group, userId: p.userId, roleName }))
                    ) {
                        placedGroupId = group.id
                    }
                }
                await tx.workspaceInvitation.delete({ where: { id: inv.id } })
            })
        } catch (error) {
            if (isP2002(error)) {
                throw new ConflictError({
                    message: 'Приглашение уже обрабатывается — обновите экран',
                })
            }
            throw error
        }

        this.realtime.invalidate(workspaceId, ['members'])
        this.realtime.invalidateUsers([p.userId], ['invitations'])
        // Now a member: open sockets start getting the club's events.
        this.realtime.joinWorkspaceRoom([p.userId], workspaceId)
        return {
            workspaceId,
            workspaceName: inv.workspace.name,
            roleName,
            groupId: placedGroupId,
        }
    }

    // The join-code path: someone entering the code of a club that already
    // invited them has consented, so the offer is accepted rather than a
    // second (pending) request being filed. Null when there is no offer.
    async acceptPendingFor(
        userId: string,
        workspaceId: string,
    ): Promise<AcceptedInvitation | null> {
        const inv = await this.prisma.workspaceInvitation.findUnique({
            where: { workspaceId_userId: { workspaceId, userId } },
            select: { id: true },
        })
        if (!inv) return null
        return this.accept({ userId, invitationId: inv.id })
    }

    // Declined by the person, or revoked by the club: the row just goes.
    // Returns the removed offer, or null when it was not there.
    async remove(where: {
        id: string
        userId?: string
        workspaceId?: string
    }): Promise<{ workspaceId: string; userId: string } | null> {
        const inv = await this.prisma.workspaceInvitation.findFirst({
            where,
            select: { id: true, workspaceId: true, userId: true },
        })
        if (!inv) return null
        await this.prisma.workspaceInvitation.deleteMany({ where: { id: inv.id } })
        this.realtime.invalidate(inv.workspaceId, ['members'])
        this.realtime.invalidateUsers([inv.userId], ['invitations'])
        return { workspaceId: inv.workspaceId, userId: inv.userId }
    }

    private warn(what: string, error: unknown) {
        this.logger.warn(
            `Failed to send ${what}: ${
                error instanceof Error ? error.message : String(error)
            }`,
        )
    }
}
