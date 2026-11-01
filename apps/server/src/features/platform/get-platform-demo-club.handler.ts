import { Feature, IFeatureHandler } from '@shelfjs/features'

import { findDemoWorkspace } from '../../domains/demo/demo-access'
import {
    DEMO_ACCOUNTS,
    DEMO_CLUB_KEY,
    DEMO_PARENT_CHILDREN,
    demoAccount,
} from '../../domains/demo/demo-accounts'
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

        const enabled = isDemoModeOn()
        const workspace = await findDemoWorkspace(this.prisma)
        const [joinCode, lastReset] = await Promise.all([
            workspace
                ? this.prisma.workspaceJoinCode.findUnique({
                      where: { workspaceId: workspace.id },
                      select: { code: true },
                  })
                : null,
            this.prisma.auditEvent.findFirst({
                where: { action: 'workspace.demoReset' },
                orderBy: { createdAt: 'desc' },
                select: { createdAt: true },
            }),
        ])
        const parent = demoAccount('parent')

        return {
            enabled,
            workspaceKey: DEMO_CLUB_KEY,
            loginCode: enabled ? (environment.demo.code?.trim() ?? null) : null,
            workspace: workspace
                ? { id: workspace.id, name: workspace.name, joinCode: joinCode?.code ?? null }
                : null,
            lastResetAt: lastReset?.createdAt.toISOString() ?? null,
            accounts: [
                ...DEMO_ACCOUNTS.map((a) => ({
                    email: a.email,
                    name: `${a.firstname} ${a.lastname}`,
                    roleLabel: a.roleLabel,
                    summary: a.summary,
                    via: null,
                })),
                ...DEMO_PARENT_CHILDREN.map((c) => ({
                    email: null,
                    name: `${c.firstname} ${c.lastname}`,
                    roleLabel: 'Ребёнок',
                    summary: 'Расписание, посещения, пояс и абонемент ребёнка — у родителя в приложении',
                    via: parent.email,
                })),
            ],
        }
    }
}
