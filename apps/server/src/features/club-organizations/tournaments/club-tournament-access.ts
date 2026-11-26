import type { CoachContext, RbacService } from '../../../shared/services/rbac.service'

// The students whose entries a coach confirms and follows: own groups (and
// managed directions); null = admin scope, the whole club. The same rule as
// assertCanWriteMember, so a count never names an entry the coach can't open.
export const coachEntryScope = async (
    rbac: RbacService,
    ctx: CoachContext,
): Promise<string[] | null> =>
    rbac.canWriteAllGroups(ctx) ? null : rbac.ownGroupMemberIds(ctx)
