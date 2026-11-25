import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { assertOrgAdmin, OrgRbacService } from '../../domains/organizations/org-access'
import {
    ListOrgAuditEventsFeature,
    ListOrgAuditEventsFeatureResponse,
} from './list-org-audit-events.feature'

const clubNameOf = (metadata: unknown): string | null =>
    metadata && typeof metadata === 'object' && 'clubName' in metadata &&
    typeof metadata.clubName === 'string'
        ? metadata.clubName
        : null

@Feature(ListOrgAuditEventsFeature)
export class ListOrgAuditEventsHandler
    implements IFeatureHandler<ListOrgAuditEventsFeature, ListOrgAuditEventsFeatureResponse>
{
    constructor(
        private readonly audit: AuditService,
        private readonly orgRbac: OrgRbacService,
    ) {}

    async execute({ payload, organizationId, invokerUserId, isSuperAdmin }: ListOrgAuditEventsFeature) {
        await assertOrgAdmin(
            this.orgRbac,
            { userId: invokerUserId, organizationId, isSuperAdmin },
            'Историю изменений видит администратор федерации',
        )
        const page = await this.audit.list({
            workspaceId: null,
            organizationId,
            curPage: payload.curPage,
            perPage: payload.perPage,
        })
        return {
            ...page,
            // A club's own decision (accept, leave, sharing) is the club's act:
            // the org sees the club, never the club person's name or e-mail.
            data: page.data.map((e) => {
                if (e.workspaceId === null) return e
                const club = clubNameOf(e.metadata)
                return {
                    ...e,
                    workspaceId: null,
                    actorId: null,
                    actorEmail: null,
                    actorLabel: club ? `Клуб «${club}»` : 'Клуб',
                }
            }),
        }
    }
}
