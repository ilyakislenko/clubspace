import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { COACHING_ROLES } from '../../shared/decorators/roles.decorator'
import { RbacService } from '../../shared/services/rbac.service'
import { displayName } from '../attendance/schemas'
import type {
    PersonalTrainingActor,
    Refusal,
} from './personal-training-utils'

const nameSelect = {
    id: true,
    firstname: true,
    lastname: true,
    email: true,
} as const

// What every handler loads and the serializer reads.
export const requestInclude = {
    options: { orderBy: { createdAt: 'asc' } },
    member: { select: nameSelect },
    coach: { select: nameSelect },
    gym: { select: { id: true, name: true, address: true } },
} as const

// Coaches who opted in AND still coach: a row of a demoted coach is stale and
// ignored, as is one whose club access has lapsed. The owner has no member row but may coach, so is admitted directly.
export const loadOfferingCoaches = async (
    prisma: PrismaService,
    workspaceId: string,
): Promise<Array<{ userId: string; displayName: string }>> => {
    const rows = await prisma.personalTrainingCoach.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'asc' },
        select: {
            userId: true,
            user: {
                select: { firstname: true, lastname: true, email: true },
            },
        },
    })
    if (rows.length === 0) return []
    const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { ownerId: true },
    })
    const now = new Date()
    const members = await prisma.workspaceMember.findMany({
        where: {
            workspaceId,
            status: 'ACTIVE',
            OR: [{ accessUntil: null }, { accessUntil: { gte: now } }],
            userId: { in: rows.map((r) => r.userId) },
        },
        select: { userId: true, role: { select: { name: true } } },
    })
    const coaching = new Set(
        members
            .filter((m) => COACHING_ROLES.includes(m.role.name as never))
            .map((m) => m.userId),
    )
    return rows
        .filter((r) => r.userId === workspace?.ownerId || coaching.has(r.userId))
        .map((r) => ({ userId: r.userId, displayName: displayName(r.user) }))
}

export const loadRequestOrThrow = async (
    prisma: PrismaService,
    workspaceId: string,
    requestId: string,
) => {
    const request = await prisma.personalTrainingRequest.findFirst({
        where: { id: requestId, workspaceId },
        include: requestInclude,
    })
    if (!request) throw new NotFoundError({ message: 'Заявка не найдена' })
    return request
}

// The participant the invoker is. An admin acts on the coach's behalf; anyone
// else gets NotFound so the request's existence does not leak.
export const resolvePersonalTrainingActor = async (
    rbac: RbacService,
    f: {
        workspaceId: string
        invokerUserId: string
        roleName: string | null
        isSuperAdmin: boolean
    },
    request: { memberId: string; coachId: string },
): Promise<PersonalTrainingActor> => {
    if (f.invokerUserId === request.memberId) return 'member'
    if (f.invokerUserId === request.coachId) return 'coach'
    const isAdmin = await rbac
        .resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        .then(
            (ctx) => rbac.canWriteAllGroups(ctx),
            () => false,
        )
    if (!isAdmin) throw new NotFoundError({ message: 'Заявка не найдена' })
    return 'coach'
}

export const throwIfRefused = (refusal: Refusal): void => {
    if (!refusal) return
    if (refusal.kind === 'conflict') {
        throw new ConflictError({ message: refusal.message })
    }
    if (refusal.kind === 'forbidden') {
        throw new ForbiddenError({ message: refusal.message })
    }
    throw new BadRequestError({ message: refusal.message })
}
