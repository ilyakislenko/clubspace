import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    applicableRequestKinds,
    loadOpenRequests,
    type RequestViewer,
} from '../../domains/requests/open-requests'
import { appFeatureSelect, toAppFeatureFlags } from '../../domains/workspace/feature-flags'
import { PrismaService } from '../../infrastructure/prisma'
import { isClubAdmin } from '../../shared/access/assert-admin-scope'
import { ForbiddenError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListOpenRequestsFeature,
    type ListOpenRequestsFeatureResponse,
    OPEN_REQUESTS_DEFAULT_PER_PAGE,
} from './list-open-requests.feature'
import { serializeOpenRequest } from './schemas'

// «Заявки»: everything members asked the club for that this viewer may
// decide, oldest first, with per-kind counts. Any staff member; the scope is
// the request rule of domains/requests (docs/design/2026-11-15-requests-inbox.md §1).
@Feature(ListOpenRequestsFeature)
export class ListOpenRequestsHandler
    implements IFeatureHandler<ListOpenRequestsFeature, ListOpenRequestsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListOpenRequestsFeature): Promise<ListOpenRequestsFeatureResponse> {
        const caller = { roleName: f.roleName, isSuperAdmin: f.isSuperAdmin }
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            ...caller,
        })
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: appFeatureSelect,
        })
        if (!workspace) throw new ForbiddenError({ message: 'Клуб не найден' })
        const now = new Date()
        const sections = toAppFeatureFlags(workspace, now)
        const viewer: RequestViewer = {
            workspaceId: f.workspaceId,
            userId: f.invokerUserId,
            clubWide: this.rbac.canWriteAllGroups(ctx),
            clubAdmin: isClubAdmin(ctx, caller),
            ownGroupMemberIds: () => this.rbac.ownGroupMemberIds(ctx),
            sections: { subscription: sections.subscription, videos: sections.videos },
        }
        const curPage = f.payload.curPage ?? 1
        const perPage = f.payload.perPage ?? OPEN_REQUESTS_DEFAULT_PER_PAGE
        const page = await loadOpenRequests(this.prisma, viewer, now, {
            kind: f.payload.kind,
            curPage,
            perPage,
        })
        return {
            data: page.rows.map(serializeOpenRequest),
            total: page.total,
            curPage,
            perPage,
            counts: page.counts,
            kinds: applicableRequestKinds(viewer),
        }
    }
}
