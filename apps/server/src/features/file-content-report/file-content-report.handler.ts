import { Feature, IFeatureHandler } from '@shelfjs/features'
import { randomUUID } from 'crypto'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    FileContentReportFeature,
    FileContentReportFeatureResponse,
} from './file-content-report.feature'

@Feature(FileContentReportFeature)
export class FileContentReportHandler
    implements
        IFeatureHandler<
            FileContentReportFeature,
            FileContentReportFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    async execute({ payload }: FileContentReportFeature) {
        const referenceId = randomUUID()

        let workspaceId: string | null = null
        if (payload.videoId) {
            const video = await this.prisma.video.findUnique({
                where: { id: payload.videoId },
                select: { workspaceId: true },
            })
            workspaceId = video?.workspaceId ?? null
        }

        await this.audit.record({
            action: 'content.report',
            targetType: 'video',
            targetId: payload.videoId ?? referenceId,
            workspaceId,
            metadata: {
                referenceId,
                reporterContact: payload.reporterContact,
                reason: payload.reason,
            },
        })

        return { status: 'received' as const, referenceId }
    }
}
