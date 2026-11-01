import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { UsersService } from '../../domains/users/services/users.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { JoinRequestService } from '../../domains/workspace/services/join-request.service'
import {
    placeInGroup,
    WorkspaceInvitationService,
} from '../../domains/workspace/services/workspace-invitation.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    ConflictError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
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
        private readonly joinRequests: JoinRequestService,
        private readonly users: UsersService,
        private readonly invitations: WorkspaceInvitationService,
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

        // An existing account is never enrolled without its owner's consent
        // (security M8): it gets an offer to accept in the app. The one
        // exception is a person who applied to this club themselves (INVITED)
        // — approving them is what they asked for.
        if (user && existing?.status !== 'INVITED') {
            const { emailSent } = await this.invitations.invite({
                workspace,
                user: { id: user.id, email },
                roleName: payload.role,
                groupId: group?.id ?? null,
                invitedById: invokerUserId,
                sendEmail: payload.sendEmail,
            })
            await this.audit.record({
                action: 'member.invite',
                targetType: 'member',
                targetId: user.id,
                workspaceId,
                actorId: invokerUserId,
                metadata: {
                    email,
                    role: payload.role,
                    groupId: group?.id ?? null,
                    outcome: 'invited',
                },
            })
            return {
                userId: user.id,
                email,
                roleName: payload.role,
                outcome: 'invited' as const,
                emailSent,
                groupId: null,
            }
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
                    // An applicant: fill blanks only. User is global, a name
                    // already on it is never overwritten from here.
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

                if (group) {
                    groupAdded = await placeInGroup(tx, {
                        group,
                        userId: id,
                        roleName: payload.role,
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

        const outcome = existing ? ('approved' as const) : ('added' as const)

        let emailSent = false
        if (payload.sendEmail) {
            // Never fails the invitation: the member is already in. A failed
            // send just reports emailSent=false.
            try {
                if (existing) {
                    // They applied from the app: the approval notice (inbox,
                    // push and e-mail) fits, "install the app" does not.
                    await this.joinRequests.notifyApproved({
                        userId,
                        workspaceId,
                        workspaceName: workspace.name,
                        membershipId: existing.id,
                    })
                    emailSent = true
                } else {
                    emailSent = await this.invitations.sendInviteEmail({
                        userId,
                        workspace,
                        email,
                        roleName: payload.role,
                    })
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
            emailSent,
            groupId: groupAdded ? (group?.id ?? null) : null,
        }
    }
}
