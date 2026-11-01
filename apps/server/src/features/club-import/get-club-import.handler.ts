import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    type ClubImportFeatureResponse,
    GetClubImportFeature,
} from './club-import.feature'
import { CLUB_IMPORT_ADMIN_MESSAGE, findClubImport } from './club-import-access'
import { serializeClubImport } from './schemas'

// Status, progress, summary and missing names — what the wizard polls.
@Feature(GetClubImportFeature)
export class GetClubImportHandler
    implements IFeatureHandler<GetClubImportFeature, ClubImportFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetClubImportFeature): Promise<ClubImportFeatureResponse> {
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
        return serializeClubImport(
            await findClubImport(this.prisma, f.workspaceId, f.importId),
        )
    }
}
