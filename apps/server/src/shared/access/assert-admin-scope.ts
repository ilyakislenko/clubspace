import { ForbiddenError } from '../errors/shared.errors'
import { CoachContext, RbacService } from '../services/rbac.service'
import type { ClubVocabulary } from '../utils/club-vocabulary'

type CallerParams = {
    userId: string
    workspaceId: string
    roleName: string | null
    isSuperAdmin: boolean
}

// A refusal in the club's words is built only when refusing.
type RefusalMessage = string | ((vocabulary: ClubVocabulary) => string)

const refuse = async (
    rbac: RbacService,
    workspaceId: string,
    message: RefusalMessage,
): Promise<never> => {
    throw new ForbiddenError({
        message:
            typeof message === 'string'
                ? message
                : message(await rbac.clubVocabulary(workspaceId)),
    })
}

// The money-and-system tier (CLUB_ADMINS): the platform super admin, the
// club owner (whatever their member row says) and an 'admin'. A head coach
// runs the sport side and is not here.
export const isClubAdmin = (
    ctx: Pick<CoachContext, 'userId' | 'workspaceOwnerId'>,
    caller: { roleName: string | null; isSuperAdmin: boolean },
): boolean =>
    caller.isSuperAdmin ||
    ctx.workspaceOwnerId === ctx.userId ||
    caller.roleName === 'admin'

// Requires the sport-lead tier (SPORT_LEADS: owner, admin, head coach) —
// whoever runs every group of the club. Used by roster, gyms, renewals and
// abonement endpoints. Returns the resolved context so callers can reuse it
// (e.g. workspaceOwnerId).
export const assertSportLead = async (
    rbac: RbacService,
    params: CallerParams,
    message: RefusalMessage = 'Нужны права администратора клуба',
): Promise<CoachContext> => {
    const ctx = await rbac.resolveCoachScope(params)
    if (!rbac.canWriteAllGroups(ctx)) {
        await refuse(rbac, params.workspaceId, message)
    }
    return ctx
}

// Requires the club-admin tier (CLUB_ADMINS: owner, admin): money (tariffs,
// refunds, payment keys, the ClubSpace subscription, revenue) and system
// (settings, staff roles, public page, integrations, import, exports, audit).
export const assertClubAdmin = async (
    rbac: RbacService,
    params: CallerParams,
    message: RefusalMessage = 'Раздел доступен владельцу и администраторам клуба',
): Promise<CoachContext> => {
    const ctx = await rbac.resolveCoachScope(params)
    if (!isClubAdmin(ctx, params)) {
        await refuse(rbac, params.workspaceId, message)
    }
    return ctx
}
