import type { PrismaService } from '../../infrastructure/prisma'
import { DEMO_CLUB_KEY } from './demo-accounts'

type DemoPrisma = Pick<PrismaService, 'workspace' | 'workspaceMember' | 'user'>

// The demo club: the demo key AND generated as a demo. A real club that
// happens to hold the key is never treated as the demo.
export const findDemoWorkspace = (prisma: Pick<PrismaService, 'workspace'>) =>
    prisma.workspace.findFirst({
        where: { key: DEMO_CLUB_KEY, isDemo: true },
        select: { id: true, key: true, name: true, createdAt: true },
    })

// The demo fixed code may only open an account that exists for the demo: a
// generated (isDemo) account, not a platform admin, owning and belonging to
// nothing but the demo club. Anything else answers like a wrong code.
export const isDemoOnlyAccount = async (
    prisma: DemoPrisma,
    user: { id: string; isSuperAdmin: boolean },
): Promise<boolean> => {
    if (user.isSuperAdmin) return false
    const row = await prisma.user.findUnique({
        where: { id: user.id },
        select: { isDemo: true },
    })
    if (!row?.isDemo) return false
    const demo = await findDemoWorkspace(prisma)
    if (!demo) return false
    const [ownedElsewhere, memberElsewhere] = await Promise.all([
        prisma.workspace.count({
            where: { ownerId: user.id, id: { not: demo.id } },
        }),
        prisma.workspaceMember.count({
            where: { userId: user.id, workspaceId: { not: demo.id } },
        }),
    ])
    return ownedElsewhere === 0 && memberElsewhere === 0
}
