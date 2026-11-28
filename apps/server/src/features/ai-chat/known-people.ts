import { pseudonymFor } from '../../domains/ai-assistant/pseudonym'
import { environment } from '../../environments/environment'
import type { PrismaService } from '../../infrastructure/prisma'
import { STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import type { KnownPerson } from './ai-chat-utils'

// Everyone in the club with a pseudonym, for taking full names out of a
// question before it goes to the AI model (pseudonymizeQuestion): the admin's
// chat and the members' video answers. Out-of-scope people get a pseudonym
// too: the chat's tools then refuse it, and the model never learns who it was.
export const loadKnownPeople = async (
    prisma: PrismaService,
    club: { workspaceId: string; ownerId: string },
): Promise<KnownPerson[]> => {
    const [members, owner] = await Promise.all([
        prisma.workspaceMember.findMany({
            where: { workspaceId: club.workspaceId },
            select: {
                userId: true,
                role: { select: { name: true } },
                user: { select: { firstname: true, lastname: true } },
            },
        }),
        prisma.user.findUnique({
            where: { id: club.ownerId },
            select: { id: true, firstname: true, lastname: true },
        }),
    ])
    const person = (
        userId: string,
        kind: KnownPerson['kind'],
        u: { firstname: string | null; lastname: string | null },
    ): KnownPerson => ({
        ref: pseudonymFor(environment.encryptionKey, club.workspaceId, userId, kind),
        kind,
        userId,
        firstname: u.firstname,
        lastname: u.lastname,
    })
    const staffRoles: readonly string[] = STAFF_ROLES
    return [
        ...members
            .filter((m) => m.userId !== club.ownerId)
            .map((m) => person(m.userId, staffRoles.includes(m.role.name) ? 'staff' : 'member', m.user)),
        ...(owner ? [person(owner.id, 'staff', owner)] : []),
    ]
}
