import { Feature, FeaturesBus, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { appLinksHtml, buildAppLinks, buildJoinUrl } from '../../domains/workspace/invite-links'
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

        const user = await this.prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                firstname: true,
                lastname: true,
                status: true,
            },
        })
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
            const code = await ensureJoinCode(this.prisma, workspace.id)
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
                            roleLabel:
                                payload.role === 'coach' ? 'тренера' : 'ученика',
                            email: escapeHtml(email),
                            joinCodeDisplay: formatJoinCode(code),
                            joinUrl: escapeHtml(
                                buildJoinUrl(environment.appUrl, code) ?? '',
                            ),
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
            emailSent = result.success
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
                groupId: group?.id ?? null,
                outcome,
                isNewUser: !user,
            },
        })

        this.realtime.invalidate(workspaceId, ['members'])

        return {
            userId,
            email,
            roleName: payload.role,
            outcome,
            isNewUser: !user,
            emailSent,
            groupId: group?.id ?? null,
        }
    }
}
