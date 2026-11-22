import { PrismaService } from '../../infrastructure/prisma'
import { type RoleName, STAFF_ROLES } from '../decorators/roles.decorator'
import { ForbiddenError } from '../errors/shared.errors'
import { CoachContext } from '../services/rbac.service'
import { type ClubVocabulary, loadClubVocabulary } from '../utils/club-vocabulary'
import { isClubAdmin } from './assert-admin-scope'

// A sport lead (head coach) runs the roster of students and parents. Staff are
// not theirs to hand out, take away or act on: inviting someone as a coach,
// removing a coach, cutting off an admin's access — anything touching a staff
// role — belongs to the club admins (owner, admin, platform super admin).
// Otherwise a head coach could promote a friend to admin, or two head coaches
// could demote the admins.
//
// Call after assertSportLead, with every role the action touches: the target's
// current role and, for a role change or an invitation, the new one. The
// refusal is built in the club's words, read only when refusing.
export const assertCanManageRoles = async (
    prisma: PrismaService,
    ctx: CoachContext,
    caller: { roleName: string | null; isSuperAdmin: boolean },
    touchedRoleNames: Array<string | null | undefined>,
    message: (vocabulary: ClubVocabulary) => string,
): Promise<void> => {
    if (isClubAdmin(ctx, caller)) return
    if (
        touchedRoleNames.some((name) =>
            STAFF_ROLES.includes(name as RoleName),
        )
    ) {
        const vocabulary = await loadClubVocabulary(prisma, ctx.workspaceId)
        throw new ForbiddenError({ message: message(vocabulary) })
    }
}
