// «Заявки»: what members asked the club for that waits on a staff decision
// (docs/design/2026-11-15-requests-inbox.md §1). The one definition of when
// a request is open and who may decide it. The inbox, «Сегодня», the MCP
// overview and the existing staff lists (freeze queue, pending applicants,
// club video reviews) build their reads from here, so they can't count
// differently.
import { Prisma, type PrismaService } from '../../infrastructure/prisma'
import { STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { ownGroupsWhere } from '../../shared/services/rbac.service'
import { memberGuardiansSelect } from '../../features/dependents/schemas'
import { reviewStaffMemberWhere } from '../../features/video-reviews/review-clip-access'
import { currentSubscriptionWhere } from '../subscriptions/current-subscriptions'

export const REQUEST_KINDS = ['join', 'freeze', 'personal', 'video'] as const
export type RequestKind = (typeof REQUEST_KINDS)[number]

export type RequestViewer = {
    workspaceId: string
    userId: string
    // rbac.canWriteAllGroups(ctx): owner, admin, head coach, super admin.
    clubWide: boolean
    // isClubAdmin: owner, admin, super admin.
    clubAdmin: boolean
    // rbac.ownGroupMemberIds(ctx); read only when a builder needs it.
    ownGroupMemberIds: () => Promise<string[]>
    // The club's app sections (toAppFeatureFlags).
    sections: { subscription: boolean; videos: boolean }
}

export type RequestCounts = Record<RequestKind, number> & { total: number }

// Merge-and-slice reads curPage × perPage rows of every kind; pending queues
// are tens of rows, so this is only a guard.
export const REQUESTS_MAX_DEPTH = 1000
export const REQUESTS_TOO_DEEP_MESSAGE = 'Слишком далеко — выберите вид заявки'

// ---- When a request is open, and who sees it ----

// Every applicant waiting in the club, whoever looks. The pending-users list
// (shown to all staff, decided by sport leads) reads this.
export const pendingJoinBaseWhere = (workspaceId: string) =>
    ({ workspaceId, status: 'INVITED' }) satisfies Prisma.WorkspaceMemberWhereInput

// Join requests the viewer may decide: club-wide viewers only, and a pending
// row holding a staff role only for club admins (assertCanManageRoles).
export const pendingJoinWhere = (
    viewer: RequestViewer,
): Prisma.WorkspaceMemberWhereInput | null => {
    if (!viewer.clubWide) return null
    return {
        ...pendingJoinBaseWhere(viewer.workspaceId),
        ...(viewer.clubAdmin ? {} : { role: { name: { notIn: [...STAFF_ROLES] } } }),
    }
}

// The staff freeze queue, whatever the club's sections say: a pending request
// on a current abonement of an active member. A coach sees what they may
// decide (canWriteMember): members of groups they coach or whose direction
// they run, never their own request.
export const freezeRequestScopeWhere = (
    viewer: Pick<RequestViewer, 'workspaceId' | 'userId' | 'clubWide'>,
    now: Date,
): Prisma.SubscriptionFreezeRequestWhereInput => ({
    workspaceId: viewer.workspaceId,
    status: 'PENDING',
    subscription: {
        ...currentSubscriptionWhere(now),
        workspaceMember: { status: 'ACTIVE' },
    },
    ...(viewer.clubWide
        ? {}
        : {
              userId: { not: viewer.userId },
              user: {
                  groupMemberships: {
                      some: {
                          group: {
                              workspaceId: viewer.workspaceId,
                              ...ownGroupsWhere(viewer.userId),
                          },
                      },
                  },
              },
          }),
})

// Freeze requests in the inbox: the queue above while «Абонемент» is on.
export const pendingFreezeWhere = (
    viewer: RequestViewer,
    now: Date,
): Prisma.SubscriptionFreezeRequestWhereInput | null =>
    viewer.sections.subscription ? freezeRequestScopeWhere(viewer, now) : null

// A personal-training request waiting on the coach with at least one of the
// member's times still ahead: the SQL twin of displayStatus ≠ EXPIRED. The
// chosen coach decides; club-wide viewers act for the coach
// (resolvePersonalTrainingActor). Never one the viewer filed as the member.
export const openPersonalTrainingWhere = (
    viewer: RequestViewer,
    now: Date,
): Prisma.PersonalTrainingRequestWhereInput => ({
    workspaceId: viewer.workspaceId,
    status: 'PENDING_COACH',
    options: { some: { proposedBy: 'member', startAt: { gt: now } } },
    memberId: { not: viewer.userId },
    ...(viewer.clubWide ? {} : { coachId: viewer.userId }),
})

// Clip statuses of a review that waits on staff (displayStatus processing or
// open): uploading isn't a request yet, failed never will be.
export const OPEN_REVIEW_CLIP_STATUSES = ['uploaded', 'processing', 'ready']

// An open «Разбор видео» while «Видео» is on, in the staff list's member
// scope, never the viewer's own clip.
export const openVideoReviewWhere = async (
    viewer: RequestViewer,
): Promise<Prisma.VideoReviewRequestWhereInput | null> => {
    if (!viewer.sections.videos) return null
    return {
        workspaceId: viewer.workspaceId,
        status: 'open',
        clip: { status: { in: OPEN_REVIEW_CLIP_STATUSES } },
        memberUserId: { not: viewer.userId },
        ...(await reviewStaffMemberWhere(viewer)),
    }
}

type RequestWheres = {
    join: Prisma.WorkspaceMemberWhereInput | null
    freeze: Prisma.SubscriptionFreezeRequestWhereInput | null
    personal: Prisma.PersonalTrainingRequestWhereInput
    video: Prisma.VideoReviewRequestWhereInput | null
}

const resolveWheres = async (viewer: RequestViewer, now: Date): Promise<RequestWheres> => ({
    join: pendingJoinWhere(viewer),
    freeze: pendingFreezeWhere(viewer, now),
    personal: openPersonalTrainingWhere(viewer, now),
    video: await openVideoReviewWhere(viewer),
})

// The kinds this viewer may get in this club, in display order.
export const applicableRequestKinds = (viewer: RequestViewer): RequestKind[] =>
    REQUEST_KINDS.filter(
        (k) =>
            (k !== 'join' || viewer.clubWide) &&
            (k !== 'freeze' || viewer.sections.subscription) &&
            (k !== 'video' || viewer.sections.videos),
    )

const countWith = async (prisma: PrismaService, w: RequestWheres): Promise<RequestCounts> => {
    const [join, freeze, personal, video] = await Promise.all([
        w.join ? prisma.workspaceMember.count({ where: w.join }) : 0,
        w.freeze ? prisma.subscriptionFreezeRequest.count({ where: w.freeze }) : 0,
        prisma.personalTrainingRequest.count({ where: w.personal }),
        w.video ? prisma.videoReviewRequest.count({ where: w.video }) : 0,
    ])
    return { join, freeze, personal, video, total: join + freeze + personal + video }
}

// Open requests per kind in the viewer's scope (0 for a kind that doesn't
// apply). «Сегодня», the tab badge and the MCP overview read this.
export const countOpenRequests = async (
    prisma: PrismaService,
    viewer: RequestViewer,
    now: Date,
): Promise<RequestCounts> => countWith(prisma, await resolveWheres(viewer, now))

// ---- The rows ----

const memberSelect = {
    id: true,
    firstname: true,
    lastname: true,
    email: true,
    dependentOf: memberGuardiansSelect,
} satisfies Prisma.UserSelect

const personSelect = {
    id: true,
    firstname: true,
    lastname: true,
    email: true,
} satisfies Prisma.UserSelect

const oldestFirst = [{ createdAt: 'asc' }, { id: 'asc' }] as const

export const joinRequestInclude = {
    user: { select: memberSelect },
    role: { select: { name: true } },
} satisfies Prisma.WorkspaceMemberInclude

export const freezeRequestInclude = {
    user: { select: memberSelect },
    subscription: { select: { endDate: true, plan: { select: { name: true } } } },
} satisfies Prisma.SubscriptionFreezeRequestInclude

const personalOptionSelect = { id: true, startAt: true, durationMin: true } as const

type PersonalRequestInclude = {
    member: { select: typeof memberSelect }
    coach: { select: typeof personSelect }
    gym: { select: { name: true } }
    options: { select: typeof personalOptionSelect }
}

// `now` narrows the options to the member's times still ahead.
export const personalRequestInclude = (now: Date) =>
    ({
        member: { select: memberSelect },
        coach: { select: personSelect },
        gym: { select: { name: true } },
        options: {
            where: { proposedBy: 'member', startAt: { gt: now } },
            orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
            select: personalOptionSelect,
        },
    }) satisfies Prisma.PersonalTrainingRequestInclude & PersonalRequestInclude

export const videoRequestInclude = {
    member: { select: memberSelect },
    clip: { select: { status: true, duration: true } },
    _count: { select: { comments: true } },
} satisfies Prisma.VideoReviewRequestInclude

export type JoinRequestRow = Prisma.WorkspaceMemberGetPayload<{
    include: typeof joinRequestInclude
}>
export type FreezeRequestRow = Prisma.SubscriptionFreezeRequestGetPayload<{
    include: typeof freezeRequestInclude
}>
export type PersonalRequestRow = Prisma.PersonalTrainingRequestGetPayload<{
    include: PersonalRequestInclude
}>
export type VideoRequestRow = Prisma.VideoReviewRequestGetPayload<{
    include: typeof videoRequestInclude
}>
// Who asked, on every kind's row (the roster's fields: name, e-mail, guardians).
export type RequestMemberRow = Prisma.UserGetPayload<{ select: typeof memberSelect }>

export type OpenRequestRow =
    | { kind: 'join'; row: JoinRequestRow }
    | { kind: 'freeze'; row: FreezeRequestRow }
    | { kind: 'personal'; row: PersonalRequestRow }
    | { kind: 'video'; row: VideoRequestRow }

// Waited longest first; the uuid breaks a tie, as each source orders.
export const compareOpenRequests = (a: OpenRequestRow, b: OpenRequestRow): number =>
    a.row.createdAt.getTime() - b.row.createdAt.getTime() ||
    (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0)

const readSources = async (
    prisma: PrismaService,
    w: RequestWheres,
    kind: RequestKind | undefined,
    take: number,
    now: Date,
): Promise<OpenRequestRow[]> => {
    const wants = (k: RequestKind) => kind === undefined || kind === k
    const [joins, freezes, personals, videos] = await Promise.all([
        w.join && wants('join')
            ? prisma.workspaceMember.findMany({
                  where: w.join,
                  orderBy: [...oldestFirst],
                  take,
                  include: joinRequestInclude,
              })
            : [],
        w.freeze && wants('freeze')
            ? prisma.subscriptionFreezeRequest.findMany({
                  where: w.freeze,
                  orderBy: [...oldestFirst],
                  take,
                  include: freezeRequestInclude,
              })
            : [],
        wants('personal')
            ? prisma.personalTrainingRequest.findMany({
                  where: w.personal,
                  orderBy: [...oldestFirst],
                  take,
                  include: personalRequestInclude(now),
              })
            : [],
        w.video && wants('video')
            ? prisma.videoReviewRequest.findMany({
                  where: w.video,
                  orderBy: [...oldestFirst],
                  take,
                  include: videoRequestInclude,
              })
            : [],
    ])
    return [
        ...joins.map((row) => ({ kind: 'join' as const, row })),
        ...freezes.map((row) => ({ kind: 'freeze' as const, row })),
        ...personals.map((row) => ({ kind: 'personal' as const, row })),
        ...videos.map((row) => ({ kind: 'video' as const, row })),
    ]
}

// One page of the inbox: each applicable kind's first curPage × perPage rows,
// merged oldest first and sliced. `counts` cover every kind in scope whatever
// `kind` says; `total` is the filtered view's.
export const loadOpenRequests = async (
    prisma: PrismaService,
    viewer: RequestViewer,
    now: Date,
    page: { kind?: RequestKind; curPage: number; perPage: number },
): Promise<{ rows: OpenRequestRow[]; total: number; counts: RequestCounts }> => {
    const depth = page.curPage * page.perPage
    if (depth > REQUESTS_MAX_DEPTH) {
        throw new BadRequestError({ message: REQUESTS_TOO_DEEP_MESSAGE })
    }
    const w = await resolveWheres(viewer, now)
    const [sources, counts] = await Promise.all([
        readSources(prisma, w, page.kind, depth, now),
        countWith(prisma, w),
    ])
    return {
        rows: sources.sort(compareOpenRequests).slice((page.curPage - 1) * page.perPage, depth),
        total: page.kind ? counts[page.kind] : counts.total,
        counts,
    }
}
