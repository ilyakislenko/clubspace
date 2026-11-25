import { type Prisma, PrismaService } from '../../../infrastructure/prisma'
import { NotFoundError } from '../../../shared/errors/shared.errors'
import { STAFF_ROLES, type RoleName } from '../../../shared/decorators/roles.decorator'

// Owner or staff of the club: they also see federation events for coaches
// (audience STAFF).
export const isClubStaff = async (
    prisma: Pick<PrismaService, 'workspace'>,
    workspaceId: string,
    userId: string,
    roleName: string | null,
): Promise<boolean> => {
    if (roleName && STAFF_ROLES.includes(roleName as RoleName)) return true
    const ws = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { ownerId: true },
    })
    return ws?.ownerId === userId
}

// Published events of organizations this club is ACTIVE in that this viewer
// may see: STAFF_AND_MEMBERS where the club allows federation events, and
// STAFF ones for the club's staff.
export const clubOrgEventsWhere = (
    workspaceId: string,
    staff: boolean,
    now: Date,
): Prisma.OrganizationEventWhereInput => ({
    publishedAt: { lte: now },
    organization: { isActive: true },
    OR: [
        {
            audience: 'STAFF_AND_MEMBERS',
            organization: {
                clubs: {
                    some: { workspaceId, status: 'ACTIVE', allowMemberEvents: true },
                },
            },
        },
        ...(staff
            ? [
                  {
                      audience: 'STAFF' as const,
                      organization: {
                          clubs: { some: { workspaceId, status: 'ACTIVE' as const } },
                      },
                  },
              ]
            : []),
    ],
})

export const CLUB_ORG_EVENT_SELECT = {
    id: true,
    organizationId: true,
    kind: true,
    title: true,
    description: true,
    startAt: true,
    endAt: true,
    timezone: true,
    place: true,
    address: true,
    audience: true,
    capacity: true,
    registrationOpen: true,
    registrationClosesAt: true,
    feeNote: true,
    publishedAt: true,
    organization: { select: { name: true } },
    hostWorkspace: { select: { name: true } },
} as const

export type ClubOrgEventRow = Prisma.OrganizationEventGetPayload<{
    select: typeof CLUB_ORG_EVENT_SELECT
}>

// One event this viewer may see in this club, or 404 (no existence leak).
export const loadVisibleOrgEvent = async (
    prisma: Pick<PrismaService, 'organizationEvent'>,
    p: { workspaceId: string; eventId: string; staff: boolean; now: Date },
): Promise<ClubOrgEventRow> => {
    const event = await prisma.organizationEvent.findFirst({
        where: { id: p.eventId, ...clubOrgEventsWhere(p.workspaceId, p.staff, p.now) },
        select: CLUB_ORG_EVENT_SELECT,
    })
    if (!event) throw new NotFoundError({ message: 'Событие не найдено' })
    return event
}
