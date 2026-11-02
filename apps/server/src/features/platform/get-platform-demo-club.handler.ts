import { Feature, IFeatureHandler } from '@shelfjs/features'

import { findDemoWorkspace } from '../../domains/demo/demo-access'
import { DEMO_CLUBS } from '../../domains/demo/demo-clubs'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import { isDemoModeOn } from '../../shared/utils/demo-mode.util'
import {
    GetPlatformDemoClubFeature,
    GetPlatformDemoClubFeatureResponse,
} from './get-platform-demo-club.feature'

@Feature(GetPlatformDemoClubFeature)
export class GetPlatformDemoClubHandler
    implements
        IFeatureHandler<GetPlatformDemoClubFeature, GetPlatformDemoClubFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: GetPlatformDemoClubFeature): Promise<GetPlatformDemoClubFeatureResponse> {
        assertPlatformAdmin(f.isSuperAdmin)

        const club = DEMO_CLUBS[f.club]
        const enabled = isDemoModeOn()
        const workspace = await findDemoWorkspace(this.prisma, club.id)
        // The demo club keeps its id across resets: its own last reset.
        const [joinCode, lastReset] = workspace
            ? await Promise.all([
                  this.prisma.workspaceJoinCode.findUnique({
                      where: { workspaceId: workspace.id },
                      select: { code: true },
                  }),
                  this.prisma.auditEvent.findFirst({
                      where: { action: 'workspace.demoReset', targetId: workspace.id },
                      orderBy: { createdAt: 'desc' },
                      select: { createdAt: true },
                  }),
              ])
            : [null, null]
        const parent = club.accounts.find((a) => a.key === 'parent')

        return {
            club: club.id,
            name: club.name,
            enabled,
            workspaceKey: club.key,
            loginCode: enabled ? (environment.demo.code?.trim() ?? null) : null,
            workspace: workspace
                ? { id: workspace.id, name: workspace.name, joinCode: joinCode?.code ?? null }
                : null,
            lastResetAt: lastReset?.createdAt.toISOString() ?? null,
            accounts: [
                ...club.accounts.map((a) => ({
                    email: a.email,
                    name: a.firstname ? `${a.firstname} ${a.lastname}` : a.lastname,
                    roleLabel: a.roleLabel,
                    summary: a.summary,
                    via: null,
                })),
                ...club.children.map((c) => ({
                    email: null,
                    name: `${c.firstname} ${c.lastname}`,
                    roleLabel: 'Ребёнок',
                    summary: club.childSummary,
                    via: parent?.email ?? null,
                })),
            ],
        }
    }
}
