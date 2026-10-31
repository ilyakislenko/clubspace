import { type RoleName } from '../decorators/roles.decorator'
import { ForbiddenError } from '../errors/shared.errors'
import { CoachContext } from '../services/rbac.service'

// Roles with club-wide admin power. Both sit in WORKSPACE_ADMINS, but they are
// not peers: only the top of the club — the owner, an admin, the platform
// super admin — may grant them, take them away, or act on a member who holds
// one. A head_coach manages coaches and students only; otherwise a head coach
// could promote a friend to admin, or two head coaches could demote the admins.
export const PRIVILEGED_ROLE_NAMES: RoleName[] = ['admin', 'head_coach']

// Call after assertWorkspaceAdmin, with every role the action touches: the
// target's current role and, for a role change, the new one.
export const assertCanManageRoles = (
    ctx: CoachContext,
    caller: { roleName: string | null; isSuperAdmin: boolean },
    touchedRoleNames: Array<string | null | undefined>,
    message: string,
): void => {
    if (
        caller.isSuperAdmin ||
        ctx.workspaceOwnerId === ctx.userId ||
        caller.roleName === 'admin'
    ) {
        return
    }
    if (
        touchedRoleNames.some((name) =>
            PRIVILEGED_ROLE_NAMES.includes(name as RoleName),
        )
    ) {
        throw new ForbiddenError({ message })
    }
}
