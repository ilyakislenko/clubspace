import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
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
    ) {}

    async execute({
        payload,
        workspaceId,
        userId,
        invokerUserId,
    }: UpdateMemberProfileFeature) {
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
            throw new NotFoundError({ message: 'Member not found' })
        }

        if (payload.email !== undefined) {
            const existing = await this.prisma.user.findUnique({
                where: { email: payload.email },
                select: { id: true },
            })
            if (existing && existing.id !== userId) {
                throw new BadRequestError({
                    message: 'This email is already used by another user',
                })
            }
        }

        // Empty-string for first/last name is normalised to null so the
        // DB doesn't end up with empty strings mixed with nulls.
        const trimmedFirst =
            payload.firstname === '' ? null : payload.firstname
        const trimmedLast =
            payload.lastname === '' ? null : payload.lastname

        const updated = await this.prisma.user.update({
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
            },
            select: {
                id: true,
                email: true,
                firstname: true,
                lastname: true,
            },
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
        }
    }
}
