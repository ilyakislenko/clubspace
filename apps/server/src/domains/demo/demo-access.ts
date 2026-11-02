import type { PrismaService } from '../../infrastructure/prisma'
import { DEMO_CLUBS, type DemoClubId, demoClubOfAccountEmail } from './demo-clubs'

type DemoPrisma = Pick<PrismaService, 'workspace' | 'workspaceMember' | 'user'>

// A demo club: its demo key AND generated as a demo. A real club that happens
// to hold the key is never treated as the demo.
export const findDemoWorkspace = (prisma: Pick<PrismaService, 'workspace'>, club: DemoClubId) =>
    prisma.workspace.findFirst({
        where: { key: DEMO_CLUBS[club].key, isDemo: true },
        select: { id: true, key: true, name: true, createdAt: true },
    })

// The demo fixed code may only open an account that exists for its demo club:
// a generated (isDemo) account with one of that club's fixed addresses, not a
// platform admin, owning and belonging to nothing but that demo club (an
// ACADEMY account never opens with the code once it joins «Ритм», and the
// other way round). Anything else answers like a wrong code.
export const isDemoOnlyAccount = async (
    prisma: DemoPrisma,
    user: { id: string; isSuperAdmin: boolean },
): Promise<boolean> => {
    if (user.isSuperAdmin) return false
    const row = await prisma.user.findUnique({
        where: { id: user.id },
        select: { isDemo: true, email: true },
    })
    if (!row?.isDemo) return false
    const club = demoClubOfAccountEmail(row.email)
    if (!club) return false
    const demo = await findDemoWorkspace(prisma, club.id)
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
