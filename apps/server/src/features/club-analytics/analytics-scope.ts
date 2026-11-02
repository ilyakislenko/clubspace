import type { AnalyticsScope } from '../../domains/analytics/analytics-reports'
import type { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { type CoachContext, ownGroupsWhere, RbacService } from '../../shared/services/rbac.service'
import { cap, loadClubVocabulary } from '../../shared/utils/club-vocabulary'
import type { AnalyticsFilter } from './schemas'

// Who sees what in «Аналитика»: owner, admin and head coach the whole club;
// anyone else (a coach, a direction manager) only the groups they act on as
// their own — the ones they coach plus every group of a direction they run
// (ownGroupsWhere), regardless of coachSeesAllGroups: money and churn of
// other coaches' students stay private. Filters narrow that further; an id
// from another club is a 404.
export const resolveAnalyticsScope = async (
    prisma: PrismaService,
    rbac: RbacService,
    f: {
        workspaceId: string
        invokerUserId: string
        roleName: string | null
        isSuperAdmin: boolean
    },
    filter: AnalyticsFilter,
): Promise<{ ctx: CoachContext; isAdmin: boolean; scope: AnalyticsScope }> => {
    const { workspaceId } = f
    const ctx = await rbac.resolveCoachScope({
        userId: f.invokerUserId,
        workspaceId,
        roleName: f.roleName,
        isSuperAdmin: f.isSuperAdmin,
    })
    const isAdmin = rbac.canWriteAllGroups(ctx)

    const [gym, direction, group, coach] = await Promise.all([
        filter.gymId
            ? prisma.gym.findFirst({ where: { id: filter.gymId, workspaceId }, select: { id: true } })
            : null,
        filter.directionId
            ? prisma.direction.findFirst({
                  where: { id: filter.directionId, workspaceId },
                  select: { id: true },
              })
            : null,
        filter.groupId
            ? prisma.group.findFirst({ where: { id: filter.groupId, workspaceId }, select: { id: true } })
            : null,
        filter.coachId
            ? prisma.groupCoach.findFirst({
                  where: { userId: filter.coachId, group: { workspaceId } },
                  select: { userId: true },
              })
            : null,
    ])
    if (filter.gymId && !gym) throw new NotFoundError({ message: 'Зал не найден' })
    if (filter.directionId && !direction) {
        throw new NotFoundError({ message: 'Направление не найдено' })
    }
    if (filter.groupId && !group) throw new NotFoundError({ message: 'Группа не найдена' })
    if (filter.coachId && !coach) {
        const v = await loadClubVocabulary(prisma, workspaceId)
        throw new NotFoundError({ message: `${cap(v.coach.nom)} не найден` })
    }

    const filtered = !!(filter.gymId || filter.directionId || filter.groupId || filter.coachId)
    if (isAdmin && !filtered) {
        return { ctx, isAdmin, scope: { groupIds: null, includeGroupless: true } }
    }
    const groups = await prisma.group.findMany({
        where: {
            workspaceId,
            ...(isAdmin ? {} : ownGroupsWhere(ctx.userId)),
            ...(filter.gymId ? { gymId: filter.gymId } : {}),
            ...(filter.directionId ? { directionId: filter.directionId } : {}),
            ...(filter.groupId ? { id: filter.groupId } : {}),
            ...(filter.coachId ? { coaches: { some: { userId: filter.coachId } } } : {}),
        },
        select: { id: true },
    })
    return {
        ctx,
        isAdmin,
        scope: { groupIds: new Set(groups.map((g) => g.id)), includeGroupless: false },
    }
}
