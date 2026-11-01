import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListClubImportRowsFeature,
    type ListClubImportRowsFeatureResponse,
} from './club-import.feature'
import { CLUB_IMPORT_ADMIN_MESSAGE, findClubImport } from './club-import-access'
import type { ClubImportRowResult } from './schemas'

// Per-row outcome of the last preview/apply, a page at a time.
@Feature(ListClubImportRowsFeature)
export class ListClubImportRowsHandler
    implements
        IFeatureHandler<ListClubImportRowsFeature, ListClubImportRowsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(
        f: ListClubImportRowsFeature,
    ): Promise<ListClubImportRowsFeatureResponse> {
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
        const row = await findClubImport(this.prisma, f.workspaceId, f.importId)
        const all = (row.rowResults ?? []) as ClubImportRowResult[]
        const { action, withMessages, offset, limit } = f.query
        const filtered = all.filter(
            (r) =>
                (!action || r.action === action) &&
                (!withMessages || r.messages.length > 0),
        )
        return {
            data: filtered.slice(offset, offset + limit),
            total: filtered.length,
        }
    }
}
