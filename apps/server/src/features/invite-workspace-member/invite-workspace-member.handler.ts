import { Feature, FeaturesBus, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { UsersService } from '../../domains/users/services/users.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { appLinksHtml, buildAppLinks, buildJoinUrl } from '../../domains/workspace/invite-links'
import { JoinRequestService } from '../../domains/workspace/services/join-request.service'
import { ensureJoinCode } from '../../domains/workspace/join-code.store'
import { formatJoinCode } from '../../domains/workspace/join-code'
import { environment } from '../../environments/environment'
import { NotificationTypeEnum, PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    ConflictError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { escapeHtml } from '../../shared/utils/escape-html'
import {
    SendNotificationFeature,
    SendNotificationFeatureResponse,
} from '../send-notification/send-notification.feature'
import {
    InviteWorkspaceMemberFeature,
    InviteWorkspaceMemberFeatureResponse,
} from './invite-workspace-member.feature'

@Feature(InviteWorkspaceMemberFeature)
export class InviteWorkspaceMemberHandler
    implements
        IFeatureHandler<
            InviteWorkspaceMemberFeature,
            InviteWorkspaceMemberFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
        private readonly bus: FeaturesBus,
        private readonly joinRequests: JoinRequestService,
        private readonly users: UsersService,
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
        roleName,
        isSuperAdmin,
    }: InviteWorkspaceMemberFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            { userId: invokerUserId, workspaceId, roleName, isSuperAdmin },
            'Приглашать участников может только администратор клуба',
        )

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { id: true, name: true, ownerId: true },
        })
        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }

        const email = payload.email.toLowerCase().trim()

        const role = await this.prisma.role.findUnique({
            where: { name: payload.role },
            select: { id: true },
        })
        if (!role) {
            throw new NotFoundError({
                message: `Роль «${payload.role}» не найдена — платформа не до конца инициализирована`,
            })
        }

        let group: { id: string; coachId: string | null } | null = null
        if (payload.groupId) {
            group = await this.prisma.group.findFirst({
                where: { id: payload.groupId, workspaceId },
                select: { id: true, coachId: true },
            })
            if (!group) {
                throw new NotFoundError({ message: 'Группа не найдена' })
            }
        }

        const user = await this.users.getUserByEmail({ email })
        if (user && (user.status === 'BLOCKED' || user.status === 'DELETED')) {
            throw new BadRequestError({
                message: 'Этот аккаунт заблокирован — пригласить его нельзя',
            })
        }
        if (user && user.id === workspace.ownerId) {
            throw new BadRequestError({
                message: 'Это владелец клуба — он уже в клубе',
            })
        }

        const existing = user
            ? await this.prisma.workspaceMember.findUnique({
                  where: {
                      userId_workspaceId: { userId: user.id, workspaceId },
                  },
                  select: { id: true, status: true },
              })
            : null
        if (existing?.status === 'ACTIVE') {
            throw new BadRequestError({
                message: `${email} уже в клубе. Роль можно изменить в списке участников`,
            })
        }

        const firstname = payload.firstname?.trim()
        const lastname = payload.lastname?.trim()

        let userId: string
        // Set only when the invitee really ended up in the group: a student
        // who is the group's own primary coach is not added as a member.
        let groupAdded = false
        try {
            userId = await this.prisma.$transaction(async (tx) => {
                let id: string
                if (user) {
                    id = user.id
                    // Fill blanks only: User is global, a name already on it
                    // is never overwritten from here.
                    const names: { firstname?: string; lastname?: string } = {}
                    if (!user.firstname?.trim() && firstname) {
                        names.firstname = firstname
                    }
                    if (!user.lastname?.trim() && lastname) {
                        names.lastname = lastname
                    }
                    if (Object.keys(names).length > 0) {
                        await tx.user.update({ where: { id }, data: names })
                    }
                } else {
                    const created = await tx.user.create({
                        data: {
                            email,
                            status: 'ACTIVE',
                            language: 'RU',
                            firstname,
                            lastname,
                        },
                        select: { id: true },
                    })
                    id = created.id
                }

                // ACTIVE, not INVITED: an admin invitation is the approval.
                if (existing) {
                    await tx.workspaceMember.update({
                        where: { id: existing.id },
                        data: { status: 'ACTIVE', roleId: role.id },
                    })
                } else {
                    await tx.workspaceMember.create({
                        data: {
                            status: 'ACTIVE',
                            workspaceId,
                            userId: id,
                            roleId: role.id,
                        },
                    })
                }

                if (group && payload.role === 'user') {
                    if (group.coachId !== id) {
                        groupAdded = true
                        await tx.groupMember.upsert({
                            where: {
                                groupId_userId: {
                                    groupId: group.id,
                                    userId: id,
                                },
                            },
                            update: {},
                            create: { groupId: group.id, userId: id },
                        })
                        await tx.dropInBooking.deleteMany({
                            where: { groupId: group.id, userId: id },
                        })
                    }
                } else if (group) {
                    groupAdded = true
                    await tx.groupMember.deleteMany({
                        where: { groupId: group.id, userId: id },
                    })
                    await tx.groupCoach.upsert({
                        where: {
                            groupId_userId: { groupId: group.id, userId: id },
                        },
                        update: {},
                        create: {
                            groupId: group.id,
                            userId: id,
                            role: 'assistant',
                        },
                    })
                }

                return id
            })
        } catch (error) {
            if ((error as { code?: string })?.code === 'P2002') {
                throw new ConflictError({
                    message:
                        'Этого участника только что добавили — обновите список',
                })
            }
            throw error
        }

        const outcome: InviteWorkspaceMemberFeatureResponse['outcome'] = !existing
            ? 'added'
            : existing.status === 'INVITED'
              ? 'approved'
              : 'restored'

        let emailSent = false
        if (payload.sendEmail) {
            // Never fails the invitation: the member is already in. A failed
            // send just reports emailSent=false.
            try {
                if (outcome === 'approved') {
                    // They applied from the app: the approval notice (inbox,
                    // push and e-mail) fits, "install the app" does not.
                    await this.joinRequests.notifyApproved({
                        userId,
                        workspaceId,
                        workspaceName: workspace.name,
                        membershipId: existing!.id,
                    })
                    emailSent = true
                } else {
                    emailSent = await this.sendInviteEmail(
                        userId,
                        workspace,
                        email,
                        payload.role,
                    )
                }
            } catch {
                emailSent = false
            }
        }

        await this.audit.record({
            action: 'member.invite',
            targetType: 'member',
            targetId: userId,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                email,
                role: payload.role,
                groupId: groupAdded ? group?.id ?? null : null,
                outcome,
                isNewUser: !user,
            },
        })

        this.realtime.invalidate(workspaceId, ['members'])
        // Every outcome leaves them ACTIVE: open sockets start getting events.
        this.realtime.joinWorkspaceRoom([userId], workspaceId)

        return {
            userId,
            email,
            roleName: payload.role,
            outcome,
            isNewUser: !user,
            emailSent,
            groupId: groupAdded ? (group?.id ?? null) : null,
        }
    }

    private async sendInviteEmail(
        userId: string,
        workspace: { id: string; name: string },
        email: string,
        role: 'user' | 'coach',
    ): Promise<boolean> {
        const code = await ensureJoinCode(this.prisma, workspace.id)
        const joinUrl = buildJoinUrl(environment.appUrl, code)
        const result = await this.bus.execute<
            SendNotificationFeature,
            SendNotificationFeatureResponse
        >(
            new SendNotificationFeature({
                userId,
                topic: `Приглашение в клуб «${workspace.name}»`,
                message: {
                    htmlTemplateKey: 'member-invite',
                    data: {
                        workspaceName: escapeHtml(workspace.name),
                        roleLabel: role === 'coach' ? 'тренера' : 'ученика',
                        email: escapeHtml(email),
                        joinCodeDisplay: formatJoinCode(code),
                        // Pre-rendered: templates have no conditionals.
                        joinLinkHtml: joinUrl
                            ? ` или откройте ссылку <a href="${escapeHtml(joinUrl)}">${escapeHtml(joinUrl)}</a>`
                            : '',
                        appLinksHtml: appLinksHtml(
                            buildAppLinks({
                                appUrl: environment.appUrl ?? '',
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
                    workspaceId: workspace.id,
                },
            }),
        )
        return result.success
    }
}
