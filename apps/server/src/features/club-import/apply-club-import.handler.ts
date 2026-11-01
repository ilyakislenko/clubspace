import { InjectQueue } from '@nestjs/bullmq'
import { Feature, IFeatureHandler } from '@shelfjs/features'
import type { Queue } from 'bullmq'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ApplyClubImportFeature,
    type ClubImportFeatureResponse,
} from './club-import.feature'
import { CLUB_IMPORT_ADMIN_MESSAGE, findClubImport } from './club-import-access'
import { CLUB_IMPORT_QUEUE, startClubImportRun } from './club-import.processor'
import { serializeClubImport } from './schemas'

// Applies a previewed import with the mapping and options that preview used,
// in the background. Only from PREVIEWED: what is applied is what was shown.
@Feature(ApplyClubImportFeature)
export class ApplyClubImportHandler
    implements IFeatureHandler<ApplyClubImportFeature, ClubImportFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        @InjectQueue(CLUB_IMPORT_QUEUE) private readonly queue: Queue,
    ) {}

    async execute(f: ApplyClubImportFeature): Promise<ClubImportFeatureResponse> {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            CLUB_IMPORT_ADMIN_MESSAGE,
        )
        await startClubImportRun(this.prisma, this.queue, {
            importId: f.importId,
            workspaceId: f.workspaceId,
            mode: 'apply',
            from: ['PREVIEWED'],
        })
        return serializeClubImport(
            await findClubImport(this.prisma, f.workspaceId, f.importId),
        )
    }
}
