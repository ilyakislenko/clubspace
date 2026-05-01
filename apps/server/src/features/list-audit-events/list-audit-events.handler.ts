import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import {
    ListAuditEventsFeature,
    ListAuditEventsFeatureResponse,
} from './list-audit-events.feature'

@Feature(ListAuditEventsFeature)
export class ListAuditEventsHandler
    implements
        IFeatureHandler<ListAuditEventsFeature, ListAuditEventsFeatureResponse>
{
    constructor(
        private readonly audit: AuditService,
        private readonly prisma: PrismaService,
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
    }: ListAuditEventsFeature) {
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { ownerId: true },
        })

        if (!workspace) {
            throw new NotFoundError({ message: 'Workspace not found' })
        }

        if (workspace.ownerId !== invokerUserId) {
            throw new ForbiddenError({
                message: 'Only workspace owner can read the audit log',
            })
        }

        return await this.audit.list({
            workspaceId,
            curPage: payload.curPage,
            perPage: payload.perPage,
        })
    }
}
