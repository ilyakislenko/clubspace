import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import {
    ListPlatformAuditFeature,
    ListPlatformAuditFeatureResponse,
    PLATFORM_AUDIT_ACTIONS,
} from './list-platform-audit.feature'

@Feature(ListPlatformAuditFeature)
export class ListPlatformAuditHandler
    implements
        IFeatureHandler<
            ListPlatformAuditFeature,
            ListPlatformAuditFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: ListPlatformAuditFeature) {
        assertPlatformAdmin(f.isSuperAdmin)

        const page = await this.audit.list({
            // null = across every club. Only reachable here, behind
            // SuperAdminGuard + this assertion.
            workspaceId: null,
            actions: [...PLATFORM_AUDIT_ACTIONS],
            curPage: f.payload.curPage,
            perPage: f.payload.perPage,
        })

        // Resolve club names in one query. A workspace can be deleted while its
        // audit rows survive (workspaceId is a plain column), so a missing name
        // is expected, not an error.
        const workspaceIds = [
            ...new Set(
                page.data
                    .map((e) => e.workspaceId)
                    .filter((id): id is string => Boolean(id)),
            ),
        ]
        const workspaces = workspaceIds.length
            ? await this.prisma.workspace.findMany({
                  where: { id: { in: workspaceIds } },
                  select: { id: true, name: true },
              })
            : []
        const nameById = new Map(workspaces.map((w) => [w.id, w.name]))

        return {
            data: page.data.map((e) => ({
                id: e.id,
                workspaceId: e.workspaceId,
                workspaceName: e.workspaceId
                    ? (nameById.get(e.workspaceId) ?? null)
                    : null,
                actorId: e.actorId,
                actorLabel: e.actorLabel,
                action: e.action,
                targetId: e.targetId,
                metadata: e.metadata,
                createdAt: e.createdAt,
            })),
            total: page.total,
            curPage: page.curPage,
            perPage: page.perPage,
        }
    }
}
