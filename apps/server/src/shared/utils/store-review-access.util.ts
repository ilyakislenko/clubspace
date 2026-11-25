import type { PrismaService } from '../../infrastructure/prisma'
import { RolesEnum } from '../interfaces/shared.intefaces'

// The store-review account's fixed code must only ever open a plain student
// account. True when the user is a platform admin, owns a club, holds any
// membership role other than the plain student one, or is on a federation's
// team (the org console shows registry names).
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

    const orgStaff = await prisma.organizationMember.count({ where: { userId: user.id } })
    if (orgStaff > 0) return true

    const memberships = await prisma.workspaceMember.findMany({
        where: { userId: user.id },
        select: { role: { select: { name: true } } },
    })
    return memberships.some(
        (m) => m.role.name.toLowerCase() !== RolesEnum.USER.toLowerCase(),
    )
}
