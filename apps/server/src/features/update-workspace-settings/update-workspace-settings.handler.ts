import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    UpdateWorkspaceSettingsFeature,
    UpdateWorkspaceSettingsFeatureResponse,
} from './update-workspace-settings.feature'

@Feature(UpdateWorkspaceSettingsFeature)
export class UpdateWorkspaceSettingsHandler
    implements
        IFeatureHandler<
            UpdateWorkspaceSettingsFeature,
            UpdateWorkspaceSettingsFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
    }: UpdateWorkspaceSettingsFeature) {
        const updated = await this.prisma.workspace.update({
            where: { id: workspaceId },
            data: {
                ...(payload.coachSeesAllGroups !== undefined
                    ? { coachSeesAllGroups: payload.coachSeesAllGroups }
                    : {}),
            },
            select: { id: true, name: true, coachSeesAllGroups: true },
        })

        await this.audit.record({
            action: 'workspace.settings.update',
            targetType: 'workspace',
            targetId: workspaceId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { changes: payload },
        })

        return updated
    }
}
