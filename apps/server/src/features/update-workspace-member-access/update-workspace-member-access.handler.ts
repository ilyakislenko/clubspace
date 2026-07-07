import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import {
    UpdateWorkspaceMemberAccessFeature,
    UpdateWorkspaceMemberAccessFeatureResponse,
} from './update-workspace-member-access.feature'

@Feature(UpdateWorkspaceMemberAccessFeature)
export class UpdateWorkspaceMemberAccessHandler
    implements
        IFeatureHandler<
            UpdateWorkspaceMemberAccessFeature,
            UpdateWorkspaceMemberAccessFeatureResponse
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
    }: UpdateWorkspaceMemberAccessFeature) {
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { ownerId: true },
        })

        if (!workspace) {
            throw new NotFoundError({ message: 'Workspace not found' })
        }

        if (workspace.ownerId !== invokerUserId) {
            throw new ForbiddenError({
                message: 'Only workspace owner can change member access',
            })
        }

        if (userId === workspace.ownerId) {
            throw new BadRequestError({
                message: 'Cannot set access window for workspace owner',
            })
        }

        const accessUntil =
            payload.accessUntil === null ? null : new Date(payload.accessUntil)

        const updated = await this.prisma.workspaceMember.update({
            where: {
                userId_workspaceId: { userId, workspaceId },
            },
            data: { accessUntil },
            select: { userId: true, accessUntil: true },
        })

        await this.audit.record({
            action: 'member.updateAccess',
            targetType: 'member',
            targetId: userId,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                accessUntil: updated.accessUntil
                    ? updated.accessUntil.toISOString()
                    : null,
            },
        })

        // Refresh the admin roster and the member's own subscription/access view.
        this.realtime.invalidate(workspaceId, ['members', 'subscription'])

        return {
            userId: updated.userId,
            accessUntil: updated.accessUntil
                ? updated.accessUntil.toISOString()
                : null,
        }
    }
}
