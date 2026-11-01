import { Feature, IFeatureHandler } from '@shelfjs/features'

import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { buildClubImportTemplate } from './club-import-fields'
import { GetClubImportTemplateFeature } from './club-import.feature'
import { CLUB_IMPORT_ADMIN_MESSAGE } from './club-import-access'

// The CSV template with the Russian headers the wizard recognises.
@Feature(GetClubImportTemplateFeature)
export class GetClubImportTemplateHandler
    implements IFeatureHandler<GetClubImportTemplateFeature, string>
{
    constructor(private readonly rbac: RbacService) {}

    async execute(f: GetClubImportTemplateFeature): Promise<string> {
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
        return buildClubImportTemplate()
    }
}
