import { ForbiddenError } from '../errors/shared.errors'
import { CoachContext, RbacService } from '../services/rbac.service'
import type { ClubVocabulary } from '../utils/club-vocabulary'

// Resolves the caller's coach scope and requires workspace-admin scope (owner
// or admin-role). Used by club-configuration endpoints (tariffs, subscriptions)
// where only owners/admins may write. Returns the resolved context so callers
// can reuse it (e.g. workspaceOwnerId).
export const assertWorkspaceAdmin = async (
    rbac: RbacService,
    params: {
        userId: string
        workspaceId: string
        roleName: string | null
        isSuperAdmin: boolean
    },
    // A refusal in the club's words is built only when refusing.
    message: string | ((vocabulary: ClubVocabulary) => string) = 'Нужны права администратора клуба',
): Promise<CoachContext> => {
    const ctx = await rbac.resolveCoachScope(params)
    if (!rbac.canWriteAllGroups(ctx)) {
        throw new ForbiddenError({
            message:
                typeof message === 'string'
                    ? message
                    : message(await rbac.clubVocabulary(params.workspaceId)),
        })
    }
    return ctx
}
