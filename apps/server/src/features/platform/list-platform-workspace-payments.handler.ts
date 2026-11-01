import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PlatformPaymentsService } from '../../domains/billing/services/platform-payments.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { serializePlatformPayment } from '../workspace-billing/schemas'
import {
    ListPlatformWorkspacePaymentsFeature,
    ListPlatformWorkspacePaymentsFeatureResponse,
} from './platform-workspace-payments.feature'

// Every payment of one club to ClubSpace, newest first.
@Feature(ListPlatformWorkspacePaymentsFeature)
export class ListPlatformWorkspacePaymentsHandler
    implements IFeatureHandler<ListPlatformWorkspacePaymentsFeature, ListPlatformWorkspacePaymentsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly payments: PlatformPaymentsService,
    ) {}

    async execute(f: ListPlatformWorkspacePaymentsFeature): Promise<ListPlatformWorkspacePaymentsFeatureResponse> {
        assertPlatformAdmin(f.isSuperAdmin)
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { id: true },
        })
        if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })
        const rows = await this.payments.list(f.workspaceId, 100)
        return { data: rows.map(serializePlatformPayment) }
    }
}
