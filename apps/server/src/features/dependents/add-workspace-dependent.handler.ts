import { Feature, FeaturesBus, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { UsersService } from '../../domains/users/services/users.service'
import {
    appLinksHtml,
    buildAppLinks,
    buildChildrenUrl,
} from '../../domains/workspace/invite-links'
import { environment } from '../../environments/environment'
import { NotificationTypeEnum, PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { escapeHtml } from '../../shared/utils/escape-html'
import {
    SendNotificationFeature,
    SendNotificationFeatureResponse,
} from '../send-notification/send-notification.feature'
import {
    AddWorkspaceDependentFeature,
    AddWorkspaceDependentFeatureResponse,
} from './add-workspace-dependent.feature'
import { dateOfBirthToDate } from './dependents-utils'

// A club adds a child: a dependent User (no e-mail) that is an ACTIVE member
// right away, plus a PENDING Guardianship to the named guardian e-mail — an
// existing account, or one created for it. Only the guardian can confirm the
// link (and give the consent for the child's data) in the app; until then
// nobody can act for the child, but the club can already roster and bill it.
@Feature(AddWorkspaceDependentFeature)
export class AddWorkspaceDependentHandler
    implements
        IFeatureHandler<
            AddWorkspaceDependentFeature,
            AddWorkspaceDependentFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly users: UsersService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
        private readonly notifications: NotificationProducerService,
        private readonly bus: FeaturesBus,
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
        roleName,
        isSuperAdmin,
    }: AddWorkspaceDependentFeature): Promise<AddWorkspaceDependentFeatureResponse> {
        await assertWorkspaceAdmin(
            this.rbac,
            { userId: invokerUserId, workspaceId, roleName, isSuperAdmin },
            'Добавлять участников может только администратор клуба',
        )

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { id: true, name: true },
        })
        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }

        const role = await this.prisma.role.findUnique({
            where: { name: 'user' },
            select: { id: true },
        })
        if (!role) {
            throw new NotFoundError({
                message:
                    'Базовая роль участника не найдена (клуб не до конца инициализирован)',
            })
        }

        if (payload.groupId) {
            const group = await this.prisma.group.findFirst({
                where: { id: payload.groupId, workspaceId },
                select: { id: true },
            })
            if (!group) {
                throw new NotFoundError({ message: 'Группа не найдена' })
            }
        }

        const guardianEmail = payload.guardianEmail.toLowerCase().trim()
        const existing = await this.users.getUserByEmail({
            email: guardianEmail,
        })
        if (
            existing &&
            (existing.status === 'BLOCKED' || existing.status === 'DELETED')
        ) {
            throw new BadRequestError({
                message:
                    'Аккаунт родителя заблокирован — укажите другой адрес',
            })
        }

        const created = await this.prisma.$transaction(async (tx) => {
            const guardianId =
                existing?.id ??
                (
                    await tx.user.create({
                        data: {
                            email: guardianEmail,
                            status: 'ACTIVE',
                            language: 'RU',
                        },
                        select: { id: true },
                    })
                ).id
            const child = await tx.user.create({
                data: {
                    email: null,
                    status: 'ACTIVE',
                    language: existing?.language ?? 'RU',
                    firstname: payload.firstname,
                    lastname: payload.lastname ?? null,
                    dateOfBirth: dateOfBirthToDate(payload.dateOfBirth),
                },
                select: { id: true },
            })
            const membership = await tx.workspaceMember.create({
                data: {
                    status: 'ACTIVE',
                    workspaceId,
                    userId: child.id,
                    roleId: role.id,
                },
                select: { id: true },
            })
            if (payload.groupId) {
                await tx.groupMember.create({
                    data: { groupId: payload.groupId, userId: child.id },
                })
            }
            const link = await tx.guardianship.create({
                data: {
                    guardianId,
                    dependentId: child.id,
                    relation: payload.relation,
                    invitedByWorkspaceId: workspaceId,
                    invitedById: invokerUserId,
                },
                select: { id: true },
            })
            return {
                guardianId,
                dependentId: child.id,
                membershipId: membership.id,
                linkId: link.id,
            }
        })

        const childName = payload.firstname
        if (existing) {
            // Inbox + push for someone who already has the app; the e-mail
            // below covers a brand-new address.
            await this.notifications.notifyUser({
                userId: created.guardianId,
                kind: 'guardian.invite',
                refId: created.linkId,
                topic: 'Подтвердите профиль ребёнка',
                message: `Клуб «${workspace.name}» добавил ребёнка ${childName} и указал вас родителем. Подтвердите в разделе «Дети».`,
                metadata: {
                    dependentId: created.dependentId,
                    invitedByWorkspaceId: workspaceId,
                },
            })
        }

        let emailSent = false
        if (payload.sendEmail) {
            emailSent = await this.sendInviteEmail(
                created.guardianId,
                workspace,
                guardianEmail,
                childName,
            )
        }

        await this.audit.record({
            action: 'member.addDependent',
            targetType: 'member',
            targetId: created.dependentId,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                guardianUserId: created.guardianId,
                guardianIsNew: !existing,
                groupId: payload.groupId ?? null,
            },
        })

        this.realtime.invalidate(workspaceId, ['members'])

        return {
            dependentId: created.dependentId,
            membershipId: created.membershipId,
            guardianUserId: created.guardianId,
            guardianIsNew: !existing,
            emailSent,
            groupId: payload.groupId ?? null,
        }
    }

    // Never fails the request: the child is already in the club.
    private async sendInviteEmail(
        guardianId: string,
        workspace: { id: string; name: string },
        email: string,
        childName: string,
    ): Promise<boolean> {
        const childrenUrl = buildChildrenUrl(environment.appUrl ?? null)
        try {
            const result = await this.bus.execute<
                SendNotificationFeature,
                SendNotificationFeatureResponse
            >(
                new SendNotificationFeature({
                    userId: guardianId,
                    topic: `Клуб «${workspace.name}» добавил вашего ребёнка`,
                    message: {
                        htmlTemplateKey: 'guardian-invite',
                        data: {
                            workspaceName: escapeHtml(workspace.name),
                            childName: escapeHtml(childName),
                            email: escapeHtml(email),
                            // Pre-rendered: templates have no conditionals.
                            childrenLinkHtml: childrenUrl
                                ? ` Или откройте ссылку <a href="${escapeHtml(childrenUrl)}">${escapeHtml(childrenUrl)}</a>.`
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
                    trialEmailWorkspaceId: workspace.id,
                    metadata: { kind: 'guardian.invite' },
                }),
            )
            return result.success
        } catch {
            return false
        }
    }
}
