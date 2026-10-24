import type { PrismaService } from '../../infrastructure/prisma'
import { RolesEnum } from '../interfaces/shared.intefaces'

// The store-review account's fixed code must only ever open a plain student
// account. True when the user is a platform admin, owns a club, or holds any
// membership role other than the plain student one.
export const hasPrivilegedAccess = async (
    prisma: PrismaService,
    user: { id: string; isSuperAdmin: boolean },
): Promise<boolean> => {
    if (user.isSuperAdmin) return true

    const owned = await prisma.workspace.findFirst({
        where: { ownerId: user.id },
        select: { id: true },
    })
    if (owned) return true

    const memberships = await prisma.workspaceMember.findMany({
        where: { userId: user.id },
        select: { role: { select: { name: true } } },
    })
    return memberships.some(
        (m) => m.role.name.toLowerCase() !== RolesEnum.USER.toLowerCase(),
    )
}
