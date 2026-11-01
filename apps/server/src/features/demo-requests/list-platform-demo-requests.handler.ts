import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import {
    ListPlatformDemoRequestsFeature,
    ListPlatformDemoRequestsFeatureResponse,
} from './demo-requests.feature'
import { serializeDemoRequest } from './schemas'

const LIMIT = 200

// The console's list of demo requests from the landing, newest first.
@Feature(ListPlatformDemoRequestsFeature)
export class ListPlatformDemoRequestsHandler
    implements
        IFeatureHandler<
            ListPlatformDemoRequestsFeature,
            ListPlatformDemoRequestsFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: ListPlatformDemoRequestsFeature) {
        assertPlatformAdmin(f.isSuperAdmin)
        const rows = await this.prisma.demoRequest.findMany({
            orderBy: { createdAt: 'desc' },
            take: LIMIT,
        })
        return { data: rows.map(serializeDemoRequest) }
    }
}
