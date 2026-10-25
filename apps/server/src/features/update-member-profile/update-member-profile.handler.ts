import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { normalizePhone } from '../../shared/utils/phone'
import {
    UpdateMemberProfileFeature,
    UpdateMemberProfileFeatureResponse,
} from './update-member-profile.feature'

@Feature(UpdateMemberProfileFeature)
export class UpdateMemberProfileHandler
    implements
        IFeatureHandler<
            UpdateMemberProfileFeature,
            UpdateMemberProfileFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
        private readonly rbac: RbacService,
    ) {}

    async execute({
        payload,
        workspaceId,
        userId,
        invokerUserId,
        roleName,
        isSuperAdmin,
    }: UpdateMemberProfileFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            { userId: invokerUserId, workspaceId, roleName, isSuperAdmin },
            'Менять профиль участника может только администратор клуба',
        )

        // Confirm the target is actually related to this workspace —
        // RoleGuard already ensured the caller is a workspace admin, but
        // we still need to refuse to edit a User who has no relation to
        // this workspace, since the User table is global. The owner has no
        // WorkspaceMember row in the normal creation flow, so bypass the
        // membership requirement for the workspace owner (an admin — or the
        // owner themselves — must still be able to set the owner's name).
        const [membership, workspace] = await Promise.all([
            this.prisma.workspaceMember.findFirst({
                where: { workspaceId, userId },
                select: { id: true },
            }),
            this.prisma.workspace.findUnique({
                where: { id: workspaceId },
                select: { ownerId: true },
            }),
        ])
        if (!membership && workspace?.ownerId !== userId) {
            throw new NotFoundError({ message: 'Участник не найден' })
        }

        const target = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { email: true, phone: true, isSuperAdmin: true },
        })
        const emailChanges =
            payload.email !== undefined &&
            payload.email !== target?.email.toLowerCase()

        // Empty string clears the phone; anything else must normalise to a
        // real number. User.phone is globally unique, so a clash is a friendly
        // 400 instead of a 500 (families sharing a number hit this).
        let phone: string | null | undefined = undefined
        if (payload.phone !== undefined) {
            phone = payload.phone === null ? null : normalizePhone(payload.phone)
            if (phone === null && payload.phone !== null && payload.phone !== '') {
                throw new BadRequestError({
                    message:
                        'Телефон: с кодом страны (+7…) или российский номер с 8 / 7 в начале',
                })
            }
        }

        const phoneChanges = phone !== undefined && phone !== target?.phone

        if (emailChanges || phoneChanges) {
            // User.email is the login identity and User.phone is a global
            // unique contact: changing either from a club would let a club
            // admin take over an account that is bigger than this club.
            const [ownsOther, memberOfOther] = await Promise.all([
                this.prisma.workspace.findFirst({
                    where: { ownerId: userId, id: { not: workspaceId } },
                    select: { id: true },
                }),
                this.prisma.workspaceMember.findFirst({
                    where: { userId, workspaceId: { not: workspaceId } },
                    select: { id: true },
                }),
            ])
            if (
                workspace?.ownerId === userId ||
                userId === invokerUserId ||
                target?.isSuperAdmin ||
                ownsOther ||
                memberOfOther
            ) {
                throw new ForbiddenError({
                    message: emailChanges
                        ? 'Email этого пользователя нельзя изменить из клуба'
                        : 'Телефон этого пользователя нельзя изменить из клуба',
                })
            }
        }

        if (payload.email !== undefined) {
            const existing = await this.prisma.user.findFirst({
                where: { email: { equals: payload.email, mode: 'insensitive' } },
                orderBy: { createdAt: 'asc' },
                select: { id: true },
            })
            if (existing && existing.id !== userId) {
                throw new BadRequestError({
                    message: 'Этот email уже занят другим пользователем',
                })
            }
        }

        if (phone) {
            const phoneOwner = await this.prisma.user.findUnique({
                where: { phone },
                select: { id: true },
            })
            if (phoneOwner && phoneOwner.id !== userId) {
                throw new BadRequestError({
                    message: 'Этот телефон уже указан у другого пользователя',
                })
            }
        }

        // Empty-string for first/last name is normalised to null so the
        // DB doesn't end up with empty strings mixed with nulls.
        const trimmedFirst =
            payload.firstname === '' ? null : payload.firstname
        const trimmedLast =
            payload.lastname === '' ? null : payload.lastname

        const updated = await this.prisma.$transaction(async (tx) => {
            const row = await tx.user.update({
                where: { id: userId },
                data: {
                    ...(trimmedFirst !== undefined
                        ? { firstname: trimmedFirst }
                        : {}),
                    ...(trimmedLast !== undefined
                        ? { lastname: trimmedLast }
                        : {}),
                    ...(payload.email !== undefined
                        ? { email: payload.email }
                        : {}),
                    ...(phone !== undefined ? { phone } : {}),
                },
                select: {
                    id: true,
                    email: true,
                    firstname: true,
                    lastname: true,
                    phone: true,
                },
            })
            // A new login identity must not keep old sessions alive.
            if (emailChanges) {
                await tx.refreshToken.deleteMany({ where: { userId } })
            }
            return row
        }).catch((e: unknown) => {
            // Lost the race against the pre-checks above; say which one.
            const err = e as { code?: string; meta?: { target?: unknown } }
            if (err.code === 'P2002') {
                throw new BadRequestError({
                    message: String(err.meta?.target).includes('phone')
                        ? 'Этот телефон уже указан у другого пользователя'
                        : 'Этот email уже занят другим пользователем',
                })
            }
            throw e
        })

        await this.audit.record({
            action: 'member.updateProfile',
            targetType: 'member',
            targetId: userId,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                changes: payload,
            },
        })

        this.realtime.invalidate(workspaceId, ['members'])

        return {
            userId: updated.id,
            email: updated.email,
            firstname: updated.firstname,
            lastname: updated.lastname,
            phone: updated.phone,
        }
    }
}
