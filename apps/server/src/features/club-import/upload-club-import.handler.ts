import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { parseClubCsv } from './club-import-csv'
import {
    type ClubImportFeatureResponse,
    UploadClubImportFeature,
} from './club-import.feature'
import { CLUB_IMPORT_ADMIN_MESSAGE } from './club-import-access'
import { serializeClubImport } from './schemas'

// Parses the CSV (encoding, separator, limits) and keeps the cells for the
// next steps. Nothing in the club changes yet.
@Feature(UploadClubImportFeature)
export class UploadClubImportHandler
    implements IFeatureHandler<UploadClubImportFeature, ClubImportFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: UploadClubImportFeature): Promise<ClubImportFeatureResponse> {
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
        const parsed = parseClubCsv(f.payload.bytes)
        const row = await this.prisma.clubImport.create({
            data: {
                workspaceId: f.workspaceId,
                createdById: f.invokerUserId,
                fileName: f.payload.fileName.slice(0, 255) || 'import.csv',
                encoding: parsed.encoding,
                delimiter: parsed.delimiter,
                headers: parsed.headers,
                rows: parsed.rows,
                total: parsed.rows.length,
            },
        })
        return serializeClubImport(row)
    }
}
